import type { Language } from '../../storage/api';
import type { AppContext } from '../context';
import { checkbox, h, labeled, select } from '../dom';
import { LANGUAGES, t } from '../i18n';

function volumeSlider(value: number, onChange: (value: number) => void): HTMLElement {
  const input = h('input', 'slider');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '5';
  input.value = String(Math.round(value * 100));
  const readout = h('span', 'slider-value', `${input.value}%`);
  input.addEventListener('input', () => {
    readout.textContent = `${input.value}%`;
    onChange(Number(input.value) / 100);
  });
  return h('span', 'slider-row', [input, readout]);
}

export function settingsPanel(ctx: AppContext): HTMLElement {
  const settings = ctx.getSettings();
  const language = select(
    LANGUAGES.map((id) => ({ value: id, label: t(`ui.language.${id}`) })),
    settings.language,
    (value) => ctx.updateSettings({ language: value as Language }),
  );
  return h('div', 'form', [
    labeled(t('ui.settings.language'), language),
    labeled(
      t('ui.settings.effects_volume'),
      volumeSlider(settings.effectsVolume, (effectsVolume) => ctx.updateSettings({ effectsVolume })),
    ),
    labeled(
      t('ui.settings.music_volume'),
      volumeSlider(settings.musicVolume, (musicVolume) => ctx.updateSettings({ musicVolume })),
    ),
    labeled(
      t('ui.settings.sound'),
      checkbox(!settings.muted, (enabled) => ctx.updateSettings({ muted: !enabled })),
    ),
    labeled(
      t('ui.settings.autosave'),
      checkbox(settings.autosave, (autosave) => ctx.updateSettings({ autosave })),
    ),
  ]);
}
