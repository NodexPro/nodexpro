import { legalIdentifierPresentation } from './legal-identifier-presentation';

export function LegalIdentifierText({
  value,
  empty = '—',
}: {
  value: string | null | undefined;
  empty?: string;
}) {
  if (!value) return <span>{empty}</span>;
  const presented = legalIdentifierPresentation(value);
  return (
    <bdi dir={presented.dir} className="nx-legal-identifier" style={{ unicodeBidi: presented.unicodeBidi }}>
      {presented.text}
    </bdi>
  );
}
