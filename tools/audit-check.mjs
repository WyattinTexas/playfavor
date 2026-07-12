#!/usr/bin/env node
/**
 * FAVOR — Audit Reconciliation Checker
 *
 * Ground truth is each card's `audit` string (Wyatt's visual card audit).
 * Parses those strings (via audit-lib) and diffs them against the structured
 * fields the engine consumes, so card behavior can never silently drift from
 * the printed card again. Run after ANY edit to data/cards.js,
 * data/missions.js, or engine specials:
 *
 *   node tools/audit-check.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  SKILLS, unalias, counts, eqCounts, fmtCounts,
  parseCardAudit, parseMissionAudit,
  CARD_TEXT_SPECIALS, MISSION_SUCCESS_SPECIALS, MISSION_FAIL_SPECIALS,
  MISSION_REQ_SPECIALS, AUDIT_QUIRKS,
} from './audit-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(root, p), 'utf8');

const window = {};
new Function('window', src('data/cards.js') + '\n' + src('data/missions.js'))(window);
const CARDS = window.FAVOR_DATA.cards;
const MISSIONS = window.FAVOR_DATA.missions;

// Specials the engine actually implements (parsed straight from the source).
const engineSrc = src('engine/gameState.js');
const ENGINE_SPECIALS = new Set([...engineSrc.matchAll(/case '([^']+)'/g)].map(m => m[1]));
[...engineSrc.matchAll(/[sS]pecial === '([^']+)'/g)].forEach(m => ENGINE_SPECIALS.add(m[1]));

let issues = 0;
const flag = (name, msg) => { issues++; console.log(`  ✗ ${name}: ${msg}`); };

function auditFor(entry) {
  const quirk = AUDIT_QUIRKS[entry.name];
  return quirk && quirk.auditOverride ? quirk.auditOverride : entry.audit;
}

// ═══ REGULAR CARDS ═══
console.log('═══ CARDS: audit vs data ═══');
for (const c of CARDS) {
  if (c.type === 'mission_letter') continue;
  const audit = auditFor(c);
  if (!audit) { flag(c.name, 'no audit text'); continue; }
  const { grants, reqs, cost } = parseCardAudit(audit);
  const label = `${c.name} [${c.type}]`;
  const textSpecial = CARD_TEXT_SPECIALS[c.name];

  // Textual ability → must carry its assigned engine special.
  if (grants.textual.length || textSpecial) {
    if (textSpecial && c.special !== textSpecial)
      flag(label, `text ability should be special '${textSpecial}', data has '${c.special}'`);
    else if (!textSpecial && !c.special)
      flag(label, `textual ability with NO special: "${grants.textual.join(' | ')}"`);
    if (c.special && !ENGINE_SPECIALS.has(c.special))
      flag(label, `special '${c.special}' NOT IMPLEMENTED in engine`);
    continue;
  }

  // OR-choice grants → special encodes the choice.
  if (grants.or.length) {
    if (!c.special || !ENGINE_SPECIALS.has(c.special))
      flag(label, `OR-grant "${grants.or.map(g => g.join(' OR ')).join('; ')}" but special '${c.special}' missing/unimplemented`);
    continue;
  }

  // Straight numeric grants.
  const dataSkills = counts(c.skills);
  if (!eqCounts(grants.skills, dataSkills))
    flag(label, `skills: audit {${fmtCounts(grants.skills)}} vs data {${fmtCounts(dataSkills)}}`);
  const r = c.rewards || {};
  if (grants.gold !== (r.gold || 0)) flag(label, `gold: audit ${grants.gold} vs data ${r.gold || 0}`);
  if (grants.scorn !== (r.scorn || 0)) flag(label, `scorn: audit ${grants.scorn} vs data ${r.scorn || 0}`);
  if (grants.prestige !== (r.prestige || 0)) flag(label, `prestige: audit ${grants.prestige} vs data ${r.prestige || 0}`);
  const dataFavor = (c.favor || 0) + (r.favor || 0);
  if (grants.favor !== dataFavor) flag(label, `favor: audit ${grants.favor} vs data ${dataFavor}`);
  if (cost !== null && cost !== (c.cost || 0)) flag(label, `cost: audit ${cost} vs data ${c.cost || 0}`);
  if (grants.mindsEye && !['minds_eye', 'minds_eye_x5', 'The Shadow Guide', 'minds_eye_x2_philosopher_stone_x5'].includes(c.special))
    flag(label, `grants ${grants.mindsEye} Mind's Eye but special is '${c.special}'`);
  if (!grants.mindsEye && c.special === 'minds_eye')
    flag(label, `special 'minds_eye' GRANTS a Mind's Eye the audit doesn't give`);
  if (grants.philStone && c.special !== 'philosopher_stone' && !String(c.special || '').startsWith('philosopher_stone'))
    flag(label, `grants Philosopher's Stone but special is '${c.special}'`);
  if (grants.maps.length) {
    const want = grants.maps[0];
    if (!c.grantsMap) flag(label, `audit grants "${want} Map" but data has no grantsMap`);
    else if (unalias(c.grantsMap) !== want) flag(label, `grantsMap: audit "${want}" vs data "${c.grantsMap}"`);
  }

  // Requirements.
  const dataReq = counts(c.requirements);
  const dataReqSkills = Object.fromEntries(Object.entries(dataReq).filter(([k]) => SKILLS.includes(k)));
  if (!eqCounts(reqs.skills, dataReqSkills))
    flag(label, `req skills: audit {${fmtCounts(reqs.skills)}} vs data {${fmtCounts(dataReqSkills)}}`);
  if (reqs.mindsEye !== (dataReq['minds_eye'] || 0)) flag(label, `req Mind's Eye: audit ${reqs.mindsEye} vs data ${dataReq['minds_eye'] || 0}`);
  if (reqs.philStone !== (dataReq['philosopher_stone'] || 0)) flag(label, `req Phil Stone: audit ${reqs.philStone} vs data ${dataReq['philosopher_stone'] || 0}`);
  if (reqs.gold !== (c.reqGold || 0)) flag(label, `req gold: audit ${reqs.gold} vs data ${c.reqGold || 0}`);
  if (reqs.favor !== (c.reqFavor || 0)) flag(label, `req favor: audit ${reqs.favor} vs data ${c.reqFavor || 0}`);
  const dataMaps = (c.reqMaps || []).map(unalias).sort();
  const wantMaps = reqs.maps.slice().sort();
  if (JSON.stringify(wantMaps) !== JSON.stringify(dataMaps))
    flag(label, `reqMaps: audit [${wantMaps}] vs data [${c.reqMaps || []}]`);
  if (c.special && !ENGINE_SPECIALS.has(c.special)) flag(label, `special '${c.special}' NOT IMPLEMENTED in engine`);
}

// ═══ MAP GRAPH ═══
console.log('\n═══ MAP GRAPH: every link closes both ways ═══');
const byName = new Map();
CARDS.forEach(c => byName.set(c.name, c));
MISSIONS.forEach(m => byName.set(m.name, m));
for (const source of [...CARDS, ...MISSIONS]) {
  if (!source.grantsMap) continue;
  const dest = byName.get(source.grantsMap) || byName.get(unalias(source.grantsMap));
  if (!dest) { flag(source.name, `grantsMap "${source.grantsMap}" → no card/mission with that name`); continue; }
  if (dest.reqMaps && !dest.reqMaps.map(unalias).includes(unalias(source.name)))
    flag(source.name, `grantsMap → "${dest.name}" but its reqMaps [${dest.reqMaps}] omit the source`);
}
for (const dest of [...CARDS, ...MISSIONS]) {
  for (const srcName of dest.reqMaps || []) {
    const source = byName.get(srcName) || byName.get(unalias(srcName));
    if (!source) { flag(dest.name, `reqMaps "${srcName}" → no such card`); continue; }
    if (unalias(source.grantsMap || '') !== unalias(dest.name))
      flag(dest.name, `reqMaps lists "${srcName}" but that card's grantsMap is "${source.grantsMap}"`);
  }
}

// ═══ MISSIONS ═══
console.log('\n═══ MISSIONS: audit vs data ═══');
for (const m of MISSIONS) {
  const audit = auditFor(m);
  if (!audit) { flag(m.name, 'no audit text'); continue; }
  const parsed = parseMissionAudit(audit);
  if (!parsed) { flag(m.name, `unparseable audit: "${audit}"`); continue; }
  const { reqs, rew, fail } = parsed;
  const label = `${m.name} [mission]`;

  const dataReq = counts(m.requirements);
  const dataReqSkills = Object.fromEntries(Object.entries(dataReq).filter(([k]) => SKILLS.includes(k)));
  if (!eqCounts(reqs.skills, dataReqSkills))
    flag(label, `req skills: audit {${fmtCounts(reqs.skills)}} vs data {${fmtCounts(dataReqSkills)}}`);
  if (reqs.mindsEye !== (dataReq['minds_eye'] || 0)) flag(label, `req Mind's Eye: audit ${reqs.mindsEye} vs data ${dataReq['minds_eye'] || 0}`);
  if (reqs.philStone !== (dataReq['philosopher_stone'] || 0)) flag(label, `req Phil Stone: audit ${reqs.philStone} vs data ${dataReq['philosopher_stone'] || 0}`);
  if (reqs.gold !== (m.reqGold || 0)) flag(label, `req gold: audit ${reqs.gold} vs data ${m.reqGold || 0}`);
  if (reqs.favor !== (m.reqFavor || 0)) flag(label, `req favor: audit ${reqs.favor} vs data ${m.reqFavor || 0}`);
  const expReqSp = MISSION_REQ_SPECIALS[m.name] || null;
  if ((m.reqSpecial || null) !== expReqSp) flag(label, `reqSpecial: expected '${expReqSp}', data '${m.reqSpecial}'`);
  if (reqs.textual.length && !expReqSp) flag(label, `textual req unmapped: "${reqs.textual.join(' | ')}"`);

  // Success: favor lives ONLY in favorValue (scored once at game end).
  const s = m.successRewards || {};
  if (s.favor) flag(label, `successRewards.favor ${s.favor} would double-count favorValue`);
  // Strict BOTH ways: a favorValue with no printed favor is an invented
  // number (how 17 phantom values crept in before 7/9).
  if ((rew.favor || 0) !== (m.favorValue || 0))
    flag(label, `favorValue: audit ${rew.favor || 0} vs data ${m.favorValue || 0}`);
  if (rew.gold !== (s.gold || 0)) flag(label, `success gold: audit ${rew.gold} vs data ${s.gold || 0}`);
  if (rew.scorn !== (s.scorn || 0)) flag(label, `success scorn: audit ${rew.scorn} vs data ${s.scorn || 0}`);
  if (rew.prestige !== (s.prestige || 0)) flag(label, `success prestige: audit ${rew.prestige} vs data ${s.prestige || 0}`);
  if (rew.mindsEye !== (s.mindsEye || 0)) flag(label, `success Mind's Eye: audit ${rew.mindsEye} vs data ${s.mindsEye || 0}`);
  if (rew.philStone !== (s.philosopherStone || 0)) flag(label, `success Phil Stone: audit ${rew.philStone} vs data ${s.philosopherStone || 0}`);
  if (!eqCounts(rew.skills, s.skills || {}))
    flag(label, `success skills: audit {${fmtCounts(rew.skills)}} vs data {${fmtCounts(s.skills || {})}}`);
  if (rew.maps.length && unalias(m.grantsMap || '') !== rew.maps[0])
    flag(label, `success map: audit "${rew.maps[0]}" vs grantsMap "${m.grantsMap || ''}"`);
  const expSSp = MISSION_SUCCESS_SPECIALS[m.name] || null;
  if ((m.successSpecial || null) !== expSSp) flag(label, `successSpecial: expected '${expSSp}', data '${m.successSpecial}'`);
  if (rew.textual.length && !expSSp) flag(label, `textual reward unmapped: "${rew.textual.join(' | ')}"`);

  const f = m.failurePenalties || {};
  if (fail.scorn !== (f.scorn || 0)) flag(label, `failure scorn: audit ${fail.scorn} vs data ${f.scorn || 0}`);
  if (fail.gold !== (f.gold || 0)) flag(label, `failure gold: audit ${fail.gold} vs data ${f.gold || 0}`);
  if (fail.prestige !== (f.prestige || 0)) flag(label, `failure prestige: audit ${fail.prestige} vs data ${f.prestige || 0}`);
  const expFSp = MISSION_FAIL_SPECIALS[m.name] || null;
  if ((m.failSpecial || null) !== expFSp) flag(label, `failSpecial: expected '${expFSp}', data '${m.failSpecial}'`);
  if (fail.textual.length && !expFSp) flag(label, `textual failure unmapped: "${fail.textual.join(' | ')}"`);

  // Every mission special key must exist in the engine.
  [m.successSpecial, m.failSpecial, m.reqSpecial].filter(Boolean).forEach(k => {
    if (!ENGINE_SPECIALS.has(k)) flag(label, `special '${k}' NOT IMPLEMENTED in engine`);
  });
}

console.log(`\n${issues === 0 ? '✅ ALL CLEAN' : `❌ ${issues} issue(s) found`}`);
process.exit(issues ? 1 : 0);
