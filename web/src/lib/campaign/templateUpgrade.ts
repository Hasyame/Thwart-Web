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
  if (stored.id !== 'aoa') return stored;
  // Android omits this property when it equals its constructor default.
  const explicitDefaults = {...stored, difficulties: stored.difficulties ?? ['standard', 'expert']};
  return JSON.stringify(normalized(expandTemplate(explicitDefaults))) === baseline ? expandTemplate(aoaRules18) : stored;
}
