// All database paths in one place. See database.rules.json for who may read / write what.
export const P = {
  allowedEmail: (emailKey: string) => `config/allowedEmails/${emailKey}`,

  user: (uid: string) => `users/${uid}`,
  userTables: (uid: string) => `users/${uid}/tables`,
  userTable: (uid: string, tid: string) => `users/${uid}/tables/${tid}`,
  userLibrary: (uid: string, kind: string) => `users/${uid}/library/${kind}`,
  userTokenLib: (uid: string) => `users/${uid}/tokenLib`,
  /** a player's saved characters live with the table, under their identity (`rid`), not in their browser */
  tableChars: (tid: string, rid: string) => `tables/${tid}/chars/${rid}`,
  dmChars: (tid: string) => `tables/${tid}/dm/chars`,
  userSetting: (uid: string, key: string) => `users/${uid}/settings/${key}`,

  table: (tid: string) => `tables/${tid}`,
  owner: (tid: string) => `tables/${tid}/owner`,
  meta: (tid: string) => `tables/${tid}/meta`,
  activeScene: (tid: string) => `tables/${tid}/meta/activeScene`,
  settings: (tid: string) => `tables/${tid}/settings`,
  uploadKey: (tid: string) => `tables/${tid}/upload/key`,
  players: (tid: string) => `tables/${tid}/players`,
  player: (tid: string, uid: string) => `tables/${tid}/players/${uid}`,
  // Handouts the DM has put in front of the players (the DM's own copies, shown or not, are under dm/).
  handouts: (tid: string) => `tables/${tid}/handouts`,
  handout: (tid: string, id: string) => `tables/${tid}/handouts/${id}`,
  dmHandouts: (tid: string) => `tables/${tid}/dm/handouts`,
  dmHandout: (tid: string, id: string) => `tables/${tid}/dm/handouts/${id}`,

  // Public per-scene data. Players can only read the ACTIVE scene.
  scene: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}`,
  sceneMeta: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}/meta`,
  sceneTokens: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}/tokens`,
  sceneToken: (tid: string, sid: string, id: string) => `tables/${tid}/scenes/${sid}/tokens/${id}`,
  sceneFog: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}/fogOps`,
  sceneWalls: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}/walls`,
  sceneWall: (tid: string, sid: string, id: string) => `tables/${tid}/scenes/${sid}/walls/${id}`,
  scenePings: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}/pings`,
  sceneDraw: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}/draw`,
  sceneDrawing: (tid: string, sid: string, id: string) => `tables/${tid}/scenes/${sid}/draw/${id}`,
  sceneLive: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}/live`,
  sceneInitPub: (tid: string, sid: string) => `tables/${tid}/scenes/${sid}/initPub`,
  sceneLiveOf: (tid: string, sid: string, uid: string) => `tables/${tid}/scenes/${sid}/live/${uid}`,

  // DM-only data (sibling of `scenes`, because database read rules cascade downwards).
  dmScene: (tid: string, sid: string) => `tables/${tid}/dm/scenes/${sid}`,
  dmSceneTokens: (tid: string, sid: string) => `tables/${tid}/dm/scenes/${sid}/tokens`,
  dmSceneToken: (tid: string, sid: string, id: string) => `tables/${tid}/dm/scenes/${sid}/tokens/${id}`,
  dmSceneInit: (tid: string, sid: string) => `tables/${tid}/dm/scenes/${sid}/init`,
  dmSceneHp: (tid: string, sid: string) => `tables/${tid}/dm/scenes/${sid}/hp`,
  dmSceneHpOf: (tid: string, sid: string, id: string) => `tables/${tid}/dm/scenes/${sid}/hp/${id}`,
  sceneIndex: (tid: string) => `tables/${tid}/dm/sceneIndex`,
  sceneFolders: (tid: string) => `tables/${tid}/dm/sceneFolders`,
};
