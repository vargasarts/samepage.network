const APPS = [
  { id: 1, name: "Roam" },
  { id: 2, name: "LogSeq" },
  { id: 3, name: "Obsidian" },
] as const;

export type AppId = typeof APPS[number]["id"];

export const appNameById = Object.fromEntries(APPS.map(a => [a.id, a.name]));

export default APPS;
