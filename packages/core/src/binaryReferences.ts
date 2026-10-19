/** Only rewrite known binary references; style/paragraph IDs have separate namespaces. */
export function isBinaryResourceReference(name: string, element: string): boolean {
  const attribute = name.split(":").at(-1)!.toLowerCase();
  if (attribute === "binaryitemidref") return true;
  const tag = element.split(":").at(-1)!.toLowerCase();
  return ["img", "image", "custompicture", "pic"].includes(tag) &&
    ["targetref", "imageref", "resourceref", "idref"].includes(attribute);
}
