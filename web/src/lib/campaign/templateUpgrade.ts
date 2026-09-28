import type { CampaignTemplate } from './types';
import { expandTemplate } from './engine';
import legacyAoa from './templates/aoa-before-v18.json';
import correctedAoa from './templates/aoa.json';

/** Defaults omitted by Android's serializer are equivalent to absent optional fields. */
function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key,v]) => !key.startsWith('_') && !(key === 'scope' && v === 'campaign')).sort(([a],[b]) => a.localeCompare(b))
      .map(([key,v]) => [key,normalized(v)])
      .filter(([,v]) => v !== null && v !== undefined && v !== false && v !== 0 && v !== '' && JSON.stringify(v) !== '[]' && JSON.stringify(v) !== '{}'));
  }
  return value;
}
const baseline = JSON.stringify(normalized(expandTemplate(legacyAoa as CampaignTemplate)));
export const aoaRules18 = correctedAoa as CampaignTemplate;

/** Read-time correction of a known official snapshot. The original and event history remain untouched. */
export function upgradeTemplate(stored: CampaignTemplate): CampaignTemplate {
  if (stored.id === 'trors') return upgradeRedSkull(stored);
  if (stored.id !== 'aoa') return stored;
  // Android omits this property when it equals its constructor default.
  const explicitDefaults = {...stored, difficulties: stored.difficulties ?? ['standard', 'expert']};
  return JSON.stringify(normalized(expandTemplate(explicitDefaults))) === baseline ? expandTemplate(aoaRules18) : stored;
}

/** Narrow corrections to the shipped mechanics. Preserve custom sets and event history. */
function upgradeRedSkull(stored: CampaignTemplate): CampaignTemplate {
  return {...stored, scenarios: stored.scenarios?.map(scenario => {
    const sets=scenario.baseSetup?.encounterSets;
    const expected=scenario.id==='s1_crossbones'
      ? ['crossbones','exper_weapon','hydra_assault','weap_master','hydra_patrol','standard']
      : scenario.id==='s4_zola'?['zola','hydra_assault','standard']:null;
    const corrected=expected && JSON.stringify(sets)===JSON.stringify(expected)
      ? sets?.map(set=>scenario.id==='s1_crossbones'&&set==='hydra_patrol'?'legions_of_hydra':scenario.id==='s4_zola'&&set==='hydra_assault'?'under_attack':set)
      : sets;
    return {...scenario,
      baseSetup:scenario.baseSetup?{...scenario.baseSetup,encounterSets:corrected}:scenario.baseSetup,
      campaignSetup:scenario.campaignSetup?.map(step=>step.action?.id==='heal'?{...step,action:{...step.action,
        label:{fr:'Obligation ajoutée · soigner',en:'Obligation added · heal'},
        effects:step.action.effects?.map(effect=>effect.counter==='hp'&&effect.value===999?{...effect,value:undefined,valueFrom:'heroCard.health' as const}:effect),
      }}:step),
      onDefeat:scenario.id==='s5_red_skull' && JSON.stringify(scenario.onDefeat?.next)===JSON.stringify([{goto:'s5_red_skull'}])
        ? {...scenario.onDefeat,next:[{lose:true,when:{difficulty:'expert'}},{goto:'s5_red_skull'}]}
        : scenario.onDefeat,
    };
  })};
}
