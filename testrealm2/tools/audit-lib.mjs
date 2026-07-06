/**
 * FAVOR — shared audit-parsing library.
 * Used by audit-check.mjs (verifier) and audit-fix.mjs (data reconciler).
 * The `audit` string on each card/mission is ground truth (Wyatt's visual
 * card audit); these helpers turn it into structured expectations.
 */

export const SKILLS = ['survival', 'charisma', 'alchemy', 'prospecting', 'knowledge', 'power'];
const SKILL_RE = new RegExp(`^(\\d+)\\s+(${SKILLS.join('|')})$`, 'i');

// Renamed cards: audit text may reference old identities.
export const ALIAS = {
  'The Magic Fiddle': 'Golden Fiddle',
  'The Thinking Tree': "Cameron's Expedition",
  'Burst of Fulfillment': "Man's Best Friend",
  'The King of the Sky': 'King of the Sky',
  'The Great North Connection': 'Great North Connection',
};
export const unalias = (n) => ALIAS[n] || n;

// ── Text abilities → engine special keys ──────────────────────────────
// Cards whose audit is a sentence, not stats. The engine implements each key.
export const CARD_TEXT_SPECIALS = {
  "Fang's Truce": 'favor_per_survival_x2',        // 2 Favor for each Survival you have
  'Lucky Pendant': 'favor_per_quest_x5',          // Favor = successful missions ×5
  'Great Vault Key': 'favor_per_sur_cha_pro',     // 1 Favor per Survival/Charisma/Prospecting
  'Sacred Chest': 'favor_per_wisdom_x8',          // 8 Favor for each Wisdom card
  "Heaven's Blade": 'power_6_if_blind_faith',     // +6 Power if you own Blind Faith
  'Marketplace Sales': 'gold_2_per_alchemy_triangle', // 2 Gold per Alchemy (you + both neighbors)
  'Royal Hilt': 'favor_per_neighbor_power',       // 1 Favor per Power your neighbors have
  'Melee Spectacular': 'gold_2_per_power_neighbors', // 2 Gold per Power your neighbors have
};

export const MISSION_SUCCESS_SPECIALS = {
  'Golden Fiddle': 'favor_per_charisma_x2',
  'Trust of the Elders': 'favor_per_knowledge_x1',
  "The Falls' Dark Sussurus": 'philosopher_stone_x2_grant',
  'Water Temple': 'philosopher_stone_x2_grant',
  'Quest for the Stones': 'scorn_to_prestige_all',
  'Mercy': 'remove_20_scorn',
  'Passing the Mirror Gate': 'duplicate_artifact',
  'Wild Experiments': 'duplicate_potion',
  'King of the Sky': 'favor_per_philstone_x10',
};

export const MISSION_FAIL_SPECIALS = {
  "Man's Best Friend": 'others_gain_5_gold',
  'Helping the Merchant': 'discard_1_played',
  'Bodyguard': 'discard_1_played',
  'Protecting Family': 'discard_weapons_gain_5_prestige',
  "Cameron's Expedition": 'discard_wisdom_gain_8_gold',
  'Wanted: Crazy Lou': 'discard_5_played',
  'Testament to Courage': 'others_gain_3_prestige',
  'Golden Fiddle': 'others_gain_3_gold',
  'The Midnight Crash': 'all_draw_act3_mission',
  'Tunnel of Trinkets': 'all_gain_2_gold',
  'Tavern Legend': 'scorn_2_per_charisma',
  'Trust of the Elders': 'scorn_10_per_knowledge',
  "The Falls' Dark Sussurus": 'you_gain_1_gold',
  'Great Scholar': 'prestige_2_per_knowledge',
  'A Promise': 'discard_any_gain_10_prestige_each',
  'Secret Grotto': 'discard_power_gain_15_prestige',
  'Alchemic Seige': 'gain_20_prestige',
  'Mercy': 'others_remove_15_scorn',
  'Passing the Mirror Gate': 'discard_1_artifact',
  'The Labyrinth': 'fortune_teller_50_prestige',
  'Champion of Legend': 'lose_all_prestige_and_scorn',
};

export const MISSION_REQ_SPECIALS = {
  'The Shadow Guide': 'favor_5_per_minds_eye',    // Req: 5 Favor for each Mind's Eye you have
};

// ── Art-verified quirks (audit text is wrong/ambiguous; card image wins) ──
export const AUDIT_QUIRKS = {
  // Green banner on the art = map GRANT; the audit's comma placement put it
  // in the Req clause. Also carries no Mind's Eye badge, so no special.
  'A Hidden Door': {
    auditOverride: '5 Favor & The Shadow Guide Map, Req: 3 Survival & 1 Knowledge, Act 2',
    dropSpecial: true,
  },
  // Audit line was a copy-paste of Forgotten Temple's. Art: 2 Knowledge +
  // 1 Philosopher's Stone, no req, no map, no favor.
  "Philosopher's Scepter": { auditOverride: "2 Knowledge & 1 Philosopher's Stone, No Req, Act 3", removeGrantsMap: true },
};

export function counts(list) {
  const c = {};
  (list || []).forEach(s => { c[s] = (c[s] || 0) + 1; });
  return c;
}
export function eqCounts(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => a[k] === b[k]);
}
export function fmtCounts(c) {
  const e = Object.entries(c);
  return e.length ? e.map(([k, v]) => (v > 1 ? `${k}×${v}` : k)).join(', ') : '—';
}

/** Parse one clause list into structured expectations. */
export function parseTokens(text) {
  const out = { skills: {}, gold: 0, scorn: 0, favor: 0, prestige: 0, mindsEye: 0, philStone: 0, maps: [], or: [], textual: [] };
  if (!text) return out;
  const tokens = text.split(/\s*[,&*]\s*|\.\s+|\.$/).map(t => t.trim()).filter(Boolean);
  for (let tok of tokens) {
    tok = tok.replace(/^[.\s]+|[.\s]+$/g, '');
    if (!tok || /^No Req/i.test(tok) || /^Req none$/i.test(tok) || /^None$/i.test(tok) || /^Act \d/i.test(tok)) continue;
    const orMatch = tok.split(/\s+OR\s+/i);
    if (orMatch.length > 1 && orMatch.every(p => SKILL_RE.test(p.trim()))) {
      out.or.push(orMatch.map(p => p.trim()));
      continue;
    }
    let m;
    if ((m = tok.match(SKILL_RE))) {
      out.skills[m[2].toLowerCase()] = (out.skills[m[2].toLowerCase()] || 0) + parseInt(m[1], 10);
    } else if ((m = tok.match(/^(\d+)\s+Philosopher'?s Stones?$/i))) {
      out.philStone += parseInt(m[1], 10);
    } else if ((m = tok.match(/^(\d+)\s+Gold$/i))) {
      out.gold += parseInt(m[1], 10);
    } else if ((m = tok.match(/^(\d+)\s+Scorn$/i))) {
      out.scorn += parseInt(m[1], 10);
    } else if ((m = tok.match(/^(\d+)\s+Favor$/i))) {
      out.favor += parseInt(m[1], 10);
    } else if ((m = tok.match(/^(\d+)\s+Prestige$/i))) {
      out.prestige += parseInt(m[1], 10);
    } else if ((m = tok.match(/^(\d+)\s+Mind'?s Eyes?$/i))) {
      out.mindsEye += parseInt(m[1], 10);
    } else if ((m = tok.match(/^Map of (.+)$/i))) {
      out.maps.push(unalias(m[1].trim()));
    } else if ((m = tok.match(/^(.+?)\s+Map$/i))) {
      out.maps.push(unalias(m[1].trim()));
    } else {
      out.textual.push(tok);
    }
  }
  return out;
}

/** Split a card audit into grants / cost / req sections. */
export function parseCardAudit(audit) {
  let work = audit;
  let cost = null; // null = audit silent on cost (data keeps art-derived value)
  const costM = work.match(/Cost\s+(\d+)\s+Gold to play/i);
  if (costM) { cost = parseInt(costM[1], 10); work = work.replace(costM[0], ''); }

  let reqText = '';
  const reqM = work.match(/Req:\s*([^.]*)/i);
  if (reqM) { reqText = reqM[1]; work = work.slice(0, reqM.index); }

  reqText = reqText.replace(/,?\s*Act \d(\s*OR\s*Act \d)?\s*$/i, '');
  const reqMaps = [];
  const baseSegs = [];
  reqText.split(/\s+OR\s+/i).forEach(seg => {
    const mm = seg.trim().replace(/[,.]$/, '').match(/^(.+?)\s+Map$/i);
    if (mm) reqMaps.push(unalias(mm[1].trim()));
    else if (seg.trim()) baseSegs.push(seg.trim());
  });

  const grants = parseTokens(work);
  const reqs = parseTokens(baseSegs.join(', '));
  reqs.maps = reqMaps;
  return { grants, reqs, cost };
}

/** Parse a mission audit: "Success Req: X, Act N Success Reward: Y Failure Reward: Z" */
export function parseMissionAudit(audit) {
  const sr = audit.match(/Success Req:\s*(.*?)(?:,?\s*Act \d(?:\s*OR\s*Act \d)?)?\s*Success Reward:\s*(.*?)\s*Failure Reward:\s*(.*)$/i);
  if (!sr) return null;
  const [, reqTxt, rewTxt, failTxt] = sr;
  return { reqs: parseTokens(reqTxt), rew: parseTokens(rewTxt), fail: parseTokens(failTxt) };
}
