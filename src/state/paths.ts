// All database paths in one place. See database.rules.json for who may read / write what.
export const P = {
  allowedEmail: (emailKey: string) => `config/allowedEmails/${emailKey}`,

  user: (uid: string) => `users/${uid}`,
  userTables: (uid: string) => `users/${uid}/tables`,
  userTable: (uid: string, tid: string) => `users/${uid}/tables/${tid}`,
  userLibrary: (uid: string, kind: string) => `users/${uid}/library/${kind}`,
  userSetting: (uid: string, key: string) => `users/${uid}/settings/${key}`,

  table: (tid: string) => `tables/${tid}`,
  owner: (tid: string) => `tables/${tid}/owner`,
  meta: (tid: string) => `tables/${tid}/meta`,
  activeScene: (tid: string) => `tables/${tid}/meta/activeScene`,
  settings: (tid: string) => `tables/${tid}/settings`,
  uploadKey: (tid: string) => `tables/${tid}/upload/key`,
  players: (tid: string) => `tables/${tid}/players`,
  player: (tid: string, uid: string) => `tables/${tid}/players/${uid}`,

  // Public per-scene data. Players can only read the ACTIVE scene.
  scene: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}`,
  sceneMeta: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}/meta`,
  sceneTokens: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}/tokens`,
  sceneToken: (tid: string, sid: string, id: string) => `tables/${tid}/scenes/${sid}/tokens/${id}`,
  sceneFog: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}/fogOps`,
  scenePings: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}/pings`,

  // DM-only data (sibling of `scenes`, because database read rules cascade downwards).
  dmScene: (tid: string, sid: string) => `tables/${tid}/dm/scenes/${sid}`,
  dmSceneTokens: (tid: string, sid: string) => `tables/${tid}/dm/scenes/${sid}/tokens`,
  dmSceneToken: (tid: string, sid: string, id: string) => `tables/${tid}/dm/scenes/${sid}/tokens/${id}`,
  sceneIndex: (tid: string) => `tables/${tid}/dm/sceneIndex`,
};
