const special=new Set([92,94,36,46,42,43,63,40,41,91,93,123,125,124]);
export function escapeSearch(value){
  if(value.includes(String.fromCharCode(0)))throw Object.assign(new Error('Search contains an invalid character.'),{status:400});
  return [...value].map(character=>special.has(character.codePointAt(0))?String.fromCharCode(92)+character:character).join('');
}
