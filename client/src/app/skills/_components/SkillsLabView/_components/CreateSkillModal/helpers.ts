/** A skill can be created once it has a name and a body. */
export function canCreate(name: string, body: string): boolean {
  return name.trim().length > 0 && body.trim().length > 0;
}
