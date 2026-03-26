import { DevToolsLocale } from '../lib/front_end/core/i18n/DevToolsLocale.js';
import { registerLocaleDataForTest } from '../lib/front_end/core/i18n/i18nImpl.js';

export function initDevToolsTracing() {
  registerLocaleDataForTest('en-US', {});

  const identity = (locale: string) => locale;
  const data = {
    settingLanguage: 'en-US',
    navigatorLanguage: '',
    lookupClosestDevToolsLocale: identity,
  };
  DevToolsLocale.instance({ create: true, data });
}
