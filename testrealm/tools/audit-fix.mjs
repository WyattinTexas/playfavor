#!/usr/bin/env node
/**
 * FAVOR — Audit Reconciler
 * Rewrites data/cards.js and data/missions.js so every structured field the
 * engine consumes matches the card's `audit` text (ground truth from Wyatt's
 * visual audit), with art-verified quirks from audit-lib applied.
 *
 *   node tools/audit-fix.mjs          # dry run — print planned changes
 *   node tools/audit-fix.mjs --write  # apply to the data files
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  SKILLS, unalias, counts, eqCounts, fmtCounts,
  parseCardAudit, parseMissionAudit,
  CARD_TEXT_SPECIALS, MISSION_SUCCESS_SPECIALS, MISSION_FAIL_SPECIALS,
  MISSION_REQ_SPECIALS, AUDIT_QUIRKS,
} from './audit-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
let changes = 0;

const arrStr = (a) => `[${a.map(s => `"${s}"`).join(', ')}]`;
const objStr = (o) => {
  const parts = Object.entries(o)
    .filter(([, v]) => v && (typeof v !== 'object' || Object.keys(v).length))
    .map(([k, v]) => typeof v === 'object'
      ? `${k}: { ${Object.entries(v).map(([sk, sv]) => `${sk}: ${sv}`).join(', ')} }`
      : `${k}: ${v}`);
  return `{ ${parts.join(', ')} }`.replace('{  }', '{}');
};

function expandReq(reqs) {
  const list = [];
  Object.entries(reqs.skills).forEach(([s, n]) => { for (let i = 0; i < n; i++) list.push(s); });
  for (let i = 0; i < reqs.mindsEye; i++) list.push('minds_eye');
  for (let i = 0; i < reqs.philStone; i++) list.push('philosopher_stone');
  return list;
}

// Property surgery on one card/mission source chunk.
// Object matcher handles one level of nesting (successRewards: { skills: {...} }).
const VALUE_RE = `(\\[[^\\]]*\\]|\\{(?:[^{}]|\\{[^{}]*\\})*\\}|"[^"]*"|[\\w.']+)`;
function setProp(chunk, key, valueStr) {
  const re = new RegExp(`${key}:\\s*${VALUE_RE}`, 's');
  if (valueStr === null) {                       // remove property
    return chunk.replace(new RegExp(`,?\\s*${key}:\\s*${VALUE_RE}`, 's'), '');
  }
  if (re.test(chunk)) return chunk.replace(re, `${key}: ${valueStr}`);
  // insert right after the name property
  return chunk.replace(/(name:\s*"[^"]*",)/, `$1 ${key}: ${valueStr},`);
}

function fixFile(path, isMission) {
  const src = readFileSync(join(root, path), 'utf8');
  const chunks = src.split(/\n\n/);
  const out = chunks.map(chunk => {
    const nameM = chunk.match(/name:\s*"([^"]+)"/);
    if (!nameM || !/id:\s*(cid|mid)\(\)/.test(chunk)) return chunk;
    const name = nameM[1];
    if (/type:\s*"mission_letter"/.test(chunk)) return chunk;
    const auditM = chunk.match(/audit:\s*"([^"]*)"/);
    if (!auditM) return chunk;

    let audit = auditM[1];
    const quirk = AUDIT_QUIRKS[name] || {};
    if (quirk.auditOverride) audit = quirk.auditOverride;

    let next = chunk;
    if (quirk.auditOverride) next = setProp(next, 'audit', `"${audit.replace(/"/g, '\\"')}"`);

    if (!isMission) {
      const { grants, reqs, cost } = parseCardAudit(audit);
      const textSpecial = CARD_TEXT_SPECIALS[name];

      if (grants.or.length && !textSpecial) return chunk; // OR-choice cards: engine-specific, leave

      // Grants
      const skillList = [];
      Object.entries(grants.skills).forEach(([s, n]) => { for (let i = 0; i < n; i++) skillList.push(s); });
      next = setProp(next, 'skills', arrStr(skillList));
      next = setProp(next, 'favor', null);
      const rew = {};
      if (grants.gold) rew.gold = grants.gold;
      if (grants.scorn) rew.scorn = grants.scorn;
      if (grants.prestige) rew.prestige = grants.prestige;
      next = setProp(next, 'rewards', objStr(rew) + (grants.favor ? `, favor: ${grants.favor}` : ''));

      // Requirements
      next = setProp(next, 'requirements', arrStr(expandReq(reqs)));
      next = setProp(next, 'reqGold', reqs.gold ? String(reqs.gold) : null);
      next = setProp(next, 'reqFavor', reqs.favor ? String(reqs.favor) : null);

      // Maps
      let grantMaps = grants.maps.slice();
      let reqMaps = reqs.maps.slice();
      if (quirk.reqMapsAreGrant) { grantMaps = grantMaps.concat(reqMaps); reqMaps = []; }
      next = setProp(next, 'reqMaps', reqMaps.length ? arrStr(reqMaps) : null);
      if (grantMaps.length) next = setProp(next, 'grantsMap', `"${grantMaps[0]}"`);
      else if (quirk.removeGrantsMap) next = setProp(next, 'grantsMap', null);

      // Specials
      if (textSpecial) next = setProp(next, 'special', `"${textSpecial}"`);
      if (quirk.dropSpecial) next = setProp(next, 'special', null);
      // Mind's Eye special is a GRANT — cards that only REQUIRE it must not carry it.
      const spM = next.match(/special:\s*"([^"]*)"/);
      const sp = spM ? spM[1] : null;
      if (sp === 'minds_eye' && !grants.mindsEye) next = setProp(next, 'special', null);
      if (sp === 'philosopher_stone' && !grants.philStone && !textSpecial) next = setProp(next, 'special', null);
      // A Philosopher's Stone grant is delivered by the special — add it if missing.
      if (grants.philStone && !textSpecial && !next.match(/special:\s*"/)) next = setProp(next, 'special', '"philosopher_stone"');
      if (name === 'Marketplace Sales') next = setProp(next, 'combo', null);
    } else {
      const parsed = parseMissionAudit(audit);
      if (!parsed) return chunk;
      const { reqs, rew, fail } = parsed;

      next = setProp(next, 'requirements', arrStr(expandReq(reqs)));
      next = setProp(next, 'reqGold', reqs.gold ? String(reqs.gold) : null);
      next = setProp(next, 'reqFavor', reqs.favor ? String(reqs.favor) : null);
      const reqSp = MISSION_REQ_SPECIALS[name];
      next = setProp(next, 'reqSpecial', reqSp ? `"${reqSp}"` : null);

      // The audit's "Success Reward: N Favor" IS the card's favor badge —
      // it scores once via favorValue at game end. Never duplicate it into
      // successRewards (that would pay the mission's favor twice).
      if (rew.favor) next = setProp(next, 'favorValue', String(rew.favor));
      const s = {};
      if (rew.gold) s.gold = rew.gold;
      if (rew.prestige) s.prestige = rew.prestige;
      if (rew.mindsEye) s.mindsEye = rew.mindsEye;
      if (rew.philStone) s.philosopherStone = rew.philStone;
      if (Object.keys(rew.skills).length) s.skills = rew.skills;
      next = setProp(next, 'successRewards', objStr(s));

      const f = {};
      if (fail.scorn) f.scorn = fail.scorn;
      if (fail.gold) f.gold = fail.gold;
      if (fail.prestige) f.prestige = fail.prestige;
      next = setProp(next, 'failurePenalties', objStr(f));

      const sSp = MISSION_SUCCESS_SPECIALS[name];
      const fSp = MISSION_FAIL_SPECIALS[name];
      next = setProp(next, 'successSpecial', sSp ? `"${sSp}"` : null);
      next = setProp(next, 'failSpecial', fSp ? `"${fSp}"` : null);

      if (rew.maps.length) next = setProp(next, 'grantsMap', `"${rew.maps[0]}"`);
    }

    if (next !== chunk) {
      changes++;
      console.log(`── ${name}`);
      // print a compact field diff
      const before = chunk.replace(/\s+/g, ' ');
      const after = next.replace(/\s+/g, ' ');
      ['skills', 'requirements', 'rewards', 'favor', 'reqMaps', 'grantsMap', 'special', 'reqGold', 'reqFavor',
       'successRewards', 'failurePenalties', 'successSpecial', 'failSpecial', 'reqSpecial', 'combo', 'audit']
        .forEach(k => {
          const re = new RegExp(`${k}: (\\[[^\\]]*\\]|\\{[^}]*\\}(?:, favor: \\d+)?|"[^"]*"|[\\w.']+)`);
          const b = (before.match(re) || [])[1];
          const a = (after.match(re) || [])[1];
          if (b !== a) console.log(`     ${k}: ${b ?? '(none)'}  →  ${a ?? '(removed)'}`);
        });
    }
    return next;
  });

  if (WRITE) writeFileSync(join(root, path), out.join('\n\n'));
}

fixFile('data/cards.js', false);
fixFile('data/missions.js', true);
console.log(`\n${changes} entr${changes === 1 ? 'y' : 'ies'} ${WRITE ? 'UPDATED' : 'would change (dry run — use --write)'}`);
