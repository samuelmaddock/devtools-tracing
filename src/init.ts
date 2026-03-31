import { DevToolsLocale } from '../lib/front_end/core/i18n/DevToolsLocale.js';
import { registerLocaleDataForTest } from '../lib/front_end/core/i18n/i18nImpl.js';
import { ExperimentName } from '../lib/front_end/core/root/ExperimentNames.js';
import { experiments } from '../lib/front_end/core/root/Runtime.js';

export function initDevToolsTracing() {
  registerLocaleDataForTest('en-US', {});

  const identity = (locale: string) => locale;
  const data = {
    settingLanguage: 'en-US',
    navigatorLanguage: '',
    lookupClosestDevToolsLocale: identity,
  };
  DevToolsLocale.instance({ create: true, data });

  // Register experiments so isEnabled() checks don't throw.
  for (const name of Object.values(ExperimentName)) {
    if (name === ExperimentName.ALL) {
      continue;
    }
    try {
      experiments.register(name, name);
    } catch {
      // Already registered.
    }
  }
}
