// Cooperative stable ordering keeps large metadata transforms off the hot path.
export const comparePhotoNames = (a, b) => a.name.localeCompare(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export async function sortPhotoRecords(records, checkpoint) {
  let source = records; let target = new Array(records.length);
  for (let width = 1; width < records.length; width *= 2) {
    for (let start = 0; start < records.length; start += width * 2) {
      const middle = Math.min(start + width, records.length); const end = Math.min(start + width * 2, records.length);
      let left = start; let right = middle;
      for (let index = start; index < end; index++) {
        target[index] = left < middle && (right >= end || comparePhotoNames(source[left].photo, source[right].photo) <= 0) ? source[left++] : source[right++];
        await checkpoint();
      }
    }
    [source, target] = [target, source];
  }
  return source;
}
