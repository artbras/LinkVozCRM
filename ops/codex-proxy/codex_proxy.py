#!/usr/bin/env python3
"""OpenAI Chat Completions -> OpenAI Codex Responses bridge.

The bridge reads Hermes' OAuth state at runtime and never persists or logs tokens.
It binds to loopback and is intended to be placed behind a private Docker bridge.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web

LOG = logging.getLogger("linkvozcrm-codex-proxy")
AUTH_PATH = Path(os.environ.get("HERMES_AUTH_PATH", "/root/.hermes/auth.json"))
UPSTREAM = os.environ.get("CODEX_UPSTREAM", "https://chatgpt.com/backend-api/codex").rstrip("/")
MODEL = os.environ.get("CODEX_MODEL", "gpt-5.6-luna")
PROXY_KEY = os.environ.get("CODEX_PROXY_API_KEY", "").strip()
MAX_BYTES = 10_000_000


def _load_token() -> str:
    data = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
    pool = data.get("credential_pool", {}).get("openai-codex", [])
    candidates = [x for x in pool if isinstance(x, dict) and x.get("access_token")]
    if not candidates:
        state = data.get("providers", {}).get("openai-codex", {})
        token = state.get("tokens", {}).get("access_token", "")
    else:
        token = candidates[0].get("access_token", "")
    if not isinstance(token, str) or not token:
        raise RuntimeError("openai-codex não autenticado no Hermes")
    return token


def _codex_headers(token: str) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "HermesAgent/codex-proxy",
        "originator": "hermes-agent",
    }
    try:
        part = token.split(".")[1]
        payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        auth = payload.get("https://api.openai.com/auth", {})
        if auth.get("chatgpt_account_id"):
            headers["ChatGPT-Account-ID"] = auth["chatgpt_account_id"]
        residency = auth.get("chatgpt_data_residency") or auth.get("chatgpt_compute_residency")
        if residency:
            headers["x-openai-internal-codex-residency"] = residency
    except Exception:
        pass
    return headers


def _check_client_key(request: web.Request) -> None:
    if PROXY_KEY and request.headers.get("Authorization") != f"Bearer {PROXY_KEY}":
        raise web.HTTPUnauthorized(text=json.dumps({"error": {"message": "invalid proxy key"}}), content_type="application/json")


def _text_parts(value: Any) -> list[dict[str, str]]:
    if isinstance(value, str):
        return [{"type": "input_text", "text": value}]
    parts: list[dict[str, str]] = []
    if isinstance(value, list):
        for part in value:
            if isinstance(part, str):
                parts.append({"type": "input_text", "text": part})
            elif isinstance(part, dict) and part.get("type") in {"text", "input_text", "output_text"}:
                parts.append({"type": "input_text", "text": str(part.get("text", ""))})
    return parts or [{"type": "input_text", "text": ""}]


def _messages_to_input(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    instructions: list[str] = []
    items: list[dict[str, Any]] = []
    for message in messages:
        role = str(message.get("role", "user"))
        content = message.get("content", "")
        if role == "system":
            instructions.append("\n".join(p["text"] for p in _text_parts(content)))
            continue
        if role == "tool":
            items.append({
                "type": "function_call_output",
                "call_id": str(message.get("tool_call_id", "")),
                "output": content if isinstance(content, str) else json.dumps(content, ensure_ascii=False),
            })
            continue
        if role == "assistant" and message.get("tool_calls"):
            for call in message["tool_calls"]:
                fn = call.get("function", {})
                items.append({
                    "type": "function_call",
                    "call_id": str(call.get("id", "")),
                    "name": str(fn.get("name", "")),
                    "arguments": str(fn.get("arguments", "{}")),
                })
            if content:
                items.append({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": str(content)}]})
            continue
        input_type = "output_text" if role == "assistant" else "input_text"
        parts = [{**p, "type": input_type} for p in _text_parts(content)]
        items.append({"type": "message", "role": role if role in {"user", "assistant"} else "user", "content": parts})
    return "\n\n".join(x for x in instructions if x), items


def _tools_to_responses(tools: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for item in tools or []:
        fn = item.get("function", {}) if isinstance(item, dict) else {}
        if not fn.get("name"):
            continue
        result.append({
            "type": "function",
            "name": fn["name"],
            "description": fn.get("description", ""),
            "parameters": fn.get("parameters", {"type": "object", "properties": {}}),
            "strict": bool(fn.get("strict", False)),
        })
    return result


def _response_text(response: dict[str, Any]) -> str:
    chunks: list[str] = []
    for item in response.get("output", []) or []:
        if item.get("type") != "message":
            continue
        for part in item.get("content", []) or []:
            if part.get("type") == "output_text":
                chunks.append(str(part.get("text", "")))
    return "".join(chunks)


def _response_tool_calls(response: dict[str, Any]) -> list[dict[str, Any]]:
    calls = []
    for item in response.get("output", []) or []:
        if item.get("type") == "function_call":
            calls.append({
                "id": item.get("call_id") or item.get("id", ""),
                "type": "function",
                "function": {"name": item.get("name", ""), "arguments": item.get("arguments", "{}")},
            })
    return calls


def _chat_response(response: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    text = _response_text(response)
    calls = _response_tool_calls(response)
    message: dict[str, Any] = {"role": "assistant", "content": text or None}
    if calls:
        message["tool_calls"] = calls
    return {
        "id": response.get("id", "chatcmpl-codex"),
        "object": "chat.completion",
        "created": int(asyncio.get_event_loop().time()),
        "model": request.get("model", MODEL),
        "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls" if calls else "stop"}],
        "usage": response.get("usage", {}),
    }


async def _request_upstream(payload: dict[str, Any]) -> tuple[int, dict[str, str], aiohttp.ClientResponse, aiohttp.ClientSession]:
    token = _load_token()
    session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, sock_connect=20, sock_read=300))
    response = await session.post(f"{UPSTREAM}/responses", json=payload, headers=_codex_headers(token))
    if response.status == 401:
        await session.close()
        try:
            subprocess.run(["hermes", "auth", "refresh", "openai-codex"], check=False, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
        token = _load_token()
        session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, sock_connect=20, sock_read=300))
        response = await session.post(f"{UPSTREAM}/responses", json=payload, headers=_codex_headers(token))
    return response.status, dict(response.headers), response, session


async def _events(response: aiohttp.ClientResponse):
    """Yield decoded SSE events; TCP chunks are not guaranteed to be lines."""
    buffer = ""
    async for raw in response.content.iter_any():
        buffer += raw.decode("utf-8", "ignore")
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            line = line.rstrip("\r")
            if not line.startswith("data:"):
                continue
            value = line[5:].strip()
            if value == "[DONE]":
                continue
            try:
                yield json.loads(value)
            except json.JSONDecodeError:
                continue


async def chat_completions(request: web.Request):
    _check_client_key(request)
    body = await request.read()
    if len(body) > MAX_BYTES:
        raise web.HTTPRequestEntityTooLarge()
    request_json = json.loads(body)
    instructions, input_items = _messages_to_input(request_json.get("messages", []))
    payload: dict[str, Any] = {
        "model": request_json.get("model", MODEL),
        "instructions": instructions,
        "input": input_items,
        # The Codex cloud endpoint requires Responses streaming even when the
        # downstream OpenAI-compatible client requested a buffered response.
        "stream": True,
        "store": False,
    }
    if request_json.get("tools"):
        payload["tools"] = _tools_to_responses(request_json["tools"])
    if request_json.get("max_tokens") is not None:
        payload["max_output_tokens"] = request_json["max_tokens"]
    status, headers, upstream, session = await _request_upstream(payload)
    if status >= 400:
        error = await upstream.read()
        await session.close()
        return web.Response(status=status, body=error, content_type="application/json")
    if not request_json.get("stream"):
        completed: dict[str, Any] | None = None
        text_parts: list[str] = []
        function_calls: dict[str, dict[str, Any]] = {}
        async for event in _events(upstream):
            if event.get("type") == "response.completed" and isinstance(event.get("response"), dict):
                completed = event["response"]
            elif event.get("type") == "response.output_text.delta":
                text_parts.append(str(event.get("delta", "")))
            elif event.get("type") == "response.function_call_arguments.delta":
                call_id = str(event.get("call_id", ""))
                function_calls.setdefault(call_id, {"type": "function_call", "call_id": call_id, "arguments": ""})["arguments"] += str(event.get("delta", ""))
        data = completed or {"id": "resp-codex", "output": [{"type": "message", "content": [{"type": "output_text", "text": "".join(text_parts)}]}]}
        if function_calls:
            data["output"] = data.get("output", []) + list(function_calls.values())
        await session.close()
        return web.json_response(_chat_response(data, request_json), status=status)

    out = web.StreamResponse(status=status, headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"})
    await out.prepare(request)
    try:
        async for event in _events(upstream):
            event_type = event.get("type", "")
            delta = ""
            if event_type == "response.output_text.delta":
                delta = str(event.get("delta", ""))
            chunk = {"id": event.get("response_id", "chatcmpl-codex"), "object": "chat.completion.chunk", "created": 0, "model": request_json.get("model", MODEL), "choices": [{"index": 0, "delta": {"content": delta}, "finish_reason": "stop" if event_type == "response.completed" else None}]}
            await out.write(("data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n").encode())
        await out.write(b"data: [DONE]\n\n")
    finally:
        await session.close()
    return out


async def models(request: web.Request) -> web.Response:
    _check_client_key(request)
    return web.json_response({"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "openai-codex"}]})


async def health(request: web.Request) -> web.Response:
    try:
        _load_token()
        return web.json_response({"status": "ok", "provider": "openai-codex", "model": MODEL})
    except Exception as exc:
        return web.json_response({"status": "degraded", "error": str(exc)}, status=503)


def create_app() -> web.Application:
    app = web.Application(client_max_size=MAX_BYTES)
    app.router.add_get("/health", health)
    app.router.add_get("/v1/models", models)
    app.router.add_post("/v1/chat/completions", chat_completions)
    return app


if __name__ == "__main__":
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    web.run_app(create_app(), host=os.environ.get("LISTEN_HOST", "127.0.0.1"), port=int(os.environ.get("LISTEN_PORT", "8646")))
