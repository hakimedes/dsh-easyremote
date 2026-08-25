import type { AgentPreset, SessionModels } from './types';

export function selectDefaultPreset(presets: AgentPreset[]) {
  const usable = presets.filter((preset) => !preset.broken);
  return usable.find((preset) => preset.isDefault) || usable[0];
}

export function modelSelectionLabel(models?: SessionModels) {
  if (!models) return 'Model';
  const group = models.groups.find((candidate) => candidate.id === models.current.provider);
  const model = group?.models.find((candidate) => candidate.id === models.current.model);
  return model?.name || models.current.model;
}
