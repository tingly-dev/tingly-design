import { useTranslation } from 'react-i18next';
import { delegateToClaude } from '../fastedit';
import { useStore } from '../store';
import { ContextChip } from './AgentBar';
import { ImageToggle } from './ImageToggle';
import { RequestBar } from './RequestBar';

/**
 * The request bar of the kinds that hand work to Claude Code only (design
 * systems, dashboards, docs): the shared bar, with nothing in its head but
 * whether the request continues the last conversation.
 */
export function AskClaude({
  placeholder,
  file,
  context,
  onOpen,
}: {
  placeholder?: string;
  file?: string;
  /** what the person is looking at, told to Claude Code before the request */
  context?: () => string;
  /** show a file the run changed */
  onOpen?: (file: string) => void;
}) {
  const { t } = useTranslation();
  const health = useStore((s) => s.health);
  const active = useStore((s) => [...s.delegates].reverse().find((d) => d.state === 'start' || d.state === 'progress'));
  const noCli = health?.claudeCli === false;
  return (
    <RequestBar
      variant="dsask"
      label={t('prompt.askClaude.label')}
      head={null}
      options={
        <>
          <ContextChip target="claude" />
          <ImageToggle />
        </>
      }
      placeholder={noCli ? t('prompt.bar.noClaudeCli') : (placeholder ?? t('prompt.askClaude.placeholder'))}
      disabled={noCli}
      busyRun={active ? { kind: 'delegate', id: active.id } : null}
      busyText={t('prompt.bar.busyClaude')}
      onSend={(req, files) => delegateToClaude(file, null, req, files, { context: context?.() || undefined })}
      onOpen={onOpen}
    />
  );
}
