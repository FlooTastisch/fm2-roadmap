const MC_HEAD_BASE = "https://api.pliep.de/mc/head/";

export function mcHeadUrl(mcName: string) {
  return MC_HEAD_BASE + encodeURIComponent(mcName.trim());
}
