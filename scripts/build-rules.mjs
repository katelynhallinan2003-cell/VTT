// Generates database.rules.json. Realtime Database rules have no functions, so the repeated
// expressions are assembled here once and inlined. Run: npm run rules
import { writeFileSync } from 'node:fs';

const TABLE = "root.child('tables').child($tid)";
const OWNER = `${TABLE}.child('owner').val() === auth.uid`;
const ACTIVE = `${TABLE}.child('meta').child('activeScene').val() === $sid`;
const perm = (name) => `${TABLE}.child('settings').child('perm').child('${name}').val() === true`;
// a permission added later: a table saved before it existed has no value, which counts as allowed
const permUnlessOff = (name) => `${TABLE}.child('settings').child('perm').child('${name}').val() !== false`;
const tplKind = (n) => ['cone', 'cube', 'sphere', 'emanation', 'beam'].map((k) => `${n}.child('k').val() === '${k}'`).join(' || ');
// Database keys can't contain '.', so the email is stored with every '.' written as ','.
// replace() is chained a few times so it also works if an engine only replaces the first match.
const EMAIL_KEY = "auth.token.email.toLowerCase()" + ".replace('.', ',')".repeat(6);
// Google account (verified) whose email is listed under /config/allowedEmails/<email with . -> ,>
const ALLOWED_DM = `auth.token.email_verified === true && root.child('config').child('allowedEmails').child(${EMAIL_KEY}).val() === true`;

const dmOnly = { '.read': `auth != null && ${OWNER}`, '.write': `auth != null && ${OWNER}` };
const readAllWriteOwner = { '.read': 'auth != null', '.write': `auth != null && ${OWNER}` };

// A player may create a token that names themselves as owner.
const CREATE = `!data.exists() && newData.exists() && newData.child('ownerUid').val() === auth.uid && ${perm('playersCreateTokens')}`;
// ...or change / delete a token that is unlocked and either theirs, unclaimed (claiming it), or movable-by-anyone.
const MAY_TOUCH = `(${perm('playersMoveAnyToken')} || data.child('ownerUid').val() === auth.uid || (!data.child('ownerUid').exists() && newData.child('ownerUid').val() === auth.uid))`;
const MAY_DELETE = `(newData.exists() || ${perm('playersDeleteAnyToken')} || data.child('ownerUid').val() === auth.uid)`;
const EDIT = `data.exists() && data.child('locked').val() !== true && ${MAY_TOUCH} && ${MAY_DELETE}`;

const rules = {
  rules: {
    config: {
      allowedEmails: {
        $email: {
          // you can only look up your own entry, so nobody can list who is allowed
          '.read': `auth != null && auth.token.email != null && ${EMAIL_KEY} === $email`,
        },
      },
    },
    users: {
      $uid: {
        '.read': 'auth != null && auth.uid === $uid',
        '.write': `auth != null && auth.uid === $uid && ${ALLOWED_DM}`,
        // saved tokens: anyone signed in keeps their own (a player's characters, the DM's templates). Private to their owner.
        tokenLib: {
          $id: {
            '.write': 'auth != null && auth.uid === $uid',
            '.validate': "newData.hasChildren(['name', 't']) && newData.child('name').isString() && newData.child('name').val().length <= 60",
          },
        },
      },
    },
    tables: {
      $tid: {
        owner: {
          '.read': 'auth != null',
          // only an allowlisted Google account can claim a new table
          '.write': `auth != null && !data.exists() && newData.val() === auth.uid && ${ALLOWED_DM}`,
          '.validate': 'newData.isString()',
        },
        meta: readAllWriteOwner,
        settings: readAllWriteOwner,
        // handouts the DM is showing (the DM's own copies live under dm/, which players cannot read)
        handouts: readAllWriteOwner,
        upload: readAllWriteOwner,
        players: {
          '.read': 'auth != null',
          $uid: { '.write': `auth != null && (auth.uid === $uid || ${OWNER})` },
        },
        // DM-only data (hidden tokens, the scene list). A sibling of `scenes` because read rules cascade downwards.
        dm: dmOnly,
        scenes: {
          $sid: {
            // players can only read the scene that is currently live
            '.read': `auth != null && (${OWNER} || ${ACTIVE})`,
            '.write': `auth != null && ${OWNER}`,
            tokens: {
              $tkid: {
                '.write': `auth != null && ${ACTIVE} && ((${CREATE}) || (${EDIT}))`,
                ownerUid: {
                  // nobody can reassign a claimed token to themselves (the DM can reassign anything)
                  '.validate': `${OWNER} || newData.val() === data.val() || (!data.exists() && newData.val() === auth.uid)`,
                },
              },
            },
            // drawings: players with the draw permission can add their own and change or remove only their own
            draw: {
              $did: {
                // spell templates have their own permission, so a table can allow them without allowing drawing
                '.write': `auth != null && ${ACTIVE} && (${perm('playersDraw')} || (${permUnlessOff('playersTemplates')} && ((${tplKind('newData')}) || (${tplKind('data')})))) && ((!data.exists() && newData.child('uid').val() === auth.uid) || (data.exists() && data.child('uid').val() === auth.uid))`,
                '.validate': `newData.hasChildren(['uid', 'k', 'p']) && (${OWNER} || newData.child('uid').val() === auth.uid)`,
              },
            },
            // short-lived plotting (ruler, test moves): everyone writes only their own entry
            live: {
              $luid: {
                '.write': `auth != null && ${ACTIVE} && auth.uid === $luid`,
              },
            },
            pings: {
              $pid: {
                '.write': `auth != null && ${ACTIVE} && ${perm('playersPing')}`,
                '.validate': "newData.hasChildren(['x', 'y', 'uid']) && newData.child('uid').val() === auth.uid",
              },
            },
          },
        },
      },
    },
  },
};

writeFileSync(new URL('../database.rules.json', import.meta.url), JSON.stringify(rules, null, 2) + '\n');
console.log('wrote database.rules.json');
