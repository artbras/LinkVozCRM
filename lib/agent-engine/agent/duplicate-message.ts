export function messageBodyKey(body: string): string {
  return body
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

export function isDuplicateMessageBody(seen: Set<string>, body: string): boolean {
  const key = messageBodyKey(body);
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}
