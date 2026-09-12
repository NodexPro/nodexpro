import { useState, type CSSProperties, type FormEvent } from 'react';
import { userFacingApiMessage } from '../api/client';
import { EmptyState } from '../templates/template-1/components/EmptyState';
import { SectionCard } from '../templates/template-1/components/SectionCard';
import { OwnerTaxKnowledgePanel } from './owner-tax-knowledge-panel';
import {
  findLegalLibrarySource,
  flattenLegalLibraryNodes,
  legalStructureItemPreview,
} from './owner-legal-library-form';
import type {
  OwnerLegalLibraryNode,
  OwnerLegalLibrarySource,
  TaxKnowledgeAggregate,
  TaxKnowledgeAllowedAction,
  UnknownRecord,
} from './owner-legal-control-types';
import '../styles/nx-modal.css';

const LIBRARY_SCHEMA_NOT_APPLIED = 'tax_legal_library_schema_not_applied';

type DialogKind =
  | 'create_tax_domain'
  | 'create_tax_legal_node_kind'
  | 'create_tax_source'
  | 'create_tax_legal_node'
  | 'create_tax_rule'
  | 'link_tax_rule_legal_node'
  | 'unlink_tax_rule_legal_node'
  | 'update_tax_domain_metadata'
  | 'update_tax_legal_node_metadata'
  | null;

const TREE_STYLE: CSSProperties = { display: 'grid', gap: 10 };
const INDENT: CSSProperties = { marginInlineStart: 18, display: 'grid', gap: 8, paddingInlineStart: 12, borderInlineStart: '1px solid #e5e7eb' };

function catalogAction(actions: TaxKnowledgeAllowedAction[], actionKey: string): TaxKnowledgeAllowedAction | null {
  return actions.find((action) => action.action_key === actionKey) ?? null;
}

function enabledAction(actions: TaxKnowledgeAllowedAction[], actionKey: string): TaxKnowledgeAllowedAction | null {
  const found = catalogAction(actions, actionKey);
  return found && found.enabled === true ? found : null;
}

function TechnicalDetails({ rows }: { rows: Array<[string, string]> }) {
  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>Technical details</summary>
      <div style={{ display: 'grid', gap: 2, marginTop: 6, fontSize: 12, color: '#4b5563' }}>
        {rows.map(([label, value]) => (
          <div key={label}>
            <span style={{ color: '#9ca3af' }}>{label}: </span>
            <span style={{ wordBreak: 'break-all' }}>{value || '—'}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function LegalNodeTree({
  nodes,
  onAddChild,
  onAddRule,
  onLinkRule,
  onUnlink,
  onEdit,
  busy,
}: {
  nodes: OwnerLegalLibraryNode[];
  onAddChild: (node: OwnerLegalLibraryNode) => void;
  onAddRule: (node: OwnerLegalLibraryNode) => void;
  onLinkRule: (node: OwnerLegalLibraryNode) => void;
  onUnlink: (linkId: string, title: string) => void;
  onEdit: (node: OwnerLegalLibraryNode) => void;
  busy: boolean;
}) {
  if (!nodes.length) return null;
  return (
    <div style={INDENT}>
      {nodes.map((node) => {
        const addChild = enabledAction(node.allowed_actions, 'create_tax_legal_node');
        const addRule = enabledAction(node.allowed_actions, 'create_tax_rule');
        const linkRule = enabledAction(node.allowed_actions, 'link_tax_rule_legal_node');
        const edit = enabledAction(node.allowed_actions, 'update_tax_legal_node_metadata');
        return (
          <div key={node.id}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div dir="auto" style={{ fontWeight: 600, fontSize: 14 }}>
                  {node.display_title || node.title}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{node.status}</div>
                <TechnicalDetails
                  rows={[
                    ['id', node.id],
                    ['node_code', node.node_code],
                    ['kind_id', node.tax_legal_node_kind_id],
                    ['parent_node_id', node.parent_node_id ?? ''],
                  ]}
                />
              </div>
              {edit ? (
                <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => onEdit(node)}>
                  Edit
                </button>
              ) : null}
              {addChild ? (
                <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => onAddChild(node)}>
                  Add Structure Item
                </button>
              ) : null}
              {addRule ? (
                <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => onAddRule(node)}>
                  Add Canonical Rule
                </button>
              ) : null}
              {linkRule ? (
                <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => onLinkRule(node)}>
                  Link Existing Rule
                </button>
              ) : null}
            </div>
            {node.linked_rules.length ? (
              <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                {node.linked_rules.map((rule) => {
                  const unlink = enabledAction(rule.allowed_actions, 'unlink_tax_rule_legal_node');
                  return (
                    <div key={rule.link_id} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span dir="auto">
                        {rule.title}
                        <span style={{ color: '#6b7280' }}>
                          {' '}
                          · {rule.status}
                          {rule.version_count ? ` · ${rule.version_count} version(s)` : ''}
                        </span>
                      </span>
                      {unlink ? (
                        <button
                          type="button"
                          className="nx-btn nx-btn-taxes-compact"
                          disabled={busy}
                          onClick={() => onUnlink(rule.link_id, rule.title)}
                        >
                          Unlink
                        </button>
                      ) : null}
                      <details>
                        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>Technical details</summary>
                        <div style={{ fontSize: 12, color: '#4b5563' }}>
                          id: {rule.tax_rule_id}
                          <br />
                          rule_code: {rule.rule_code}
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <LegalNodeTree
              nodes={node.children}
              onAddChild={onAddChild}
              onAddRule={onAddRule}
              onLinkRule={onLinkRule}
              onUnlink={onUnlink}
              onEdit={onEdit}
              busy={busy}
            />
          </div>
        );
      })}
    </div>
  );
}

function SourceBlock({
  source,
  onAddNode,
  onAddChild,
  onAddRule,
  onLinkRule,
  onUnlink,
  onEditNode,
  busy,
}: {
  source: OwnerLegalLibrarySource;
  onAddNode: (source: OwnerLegalLibrarySource) => void;
  onAddChild: (node: OwnerLegalLibraryNode) => void;
  onAddRule: (node: OwnerLegalLibraryNode) => void;
  onLinkRule: (node: OwnerLegalLibraryNode) => void;
  onUnlink: (linkId: string, title: string) => void;
  onEditNode: (node: OwnerLegalLibraryNode) => void;
  busy: boolean;
}) {
  const addNode = enabledAction(source.allowed_actions, 'create_tax_legal_node');
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div dir="auto" style={{ fontWeight: 600 }}>
            → {source.title}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {source.provenance_type_label || source.provenance_type} · {source.status}
          </div>
          <TechnicalDetails
            rows={[
              ['id', source.id],
              ['source_code', source.source_code],
              ['provenance_type', source.provenance_type],
            ]}
          />
        </div>
        {addNode ? (
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => onAddNode(source)}>
            Add Structure Item
          </button>
        ) : null}
      </div>
      <LegalNodeTree
        nodes={source.nodes}
        onAddChild={onAddChild}
        onAddRule={onAddRule}
        onLinkRule={onLinkRule}
        onUnlink={onUnlink}
        onEdit={onEditNode}
        busy={busy}
      />
    </div>
  );
}

export function OwnerLegalLibraryPanel({
  taxKnowledge,
  countryPacks,
  rulesets,
  legalValues,
  pendingCountryCode,
  busy,
  onSelectCountry,
  onCommand,
}: {
  taxKnowledge: TaxKnowledgeAggregate;
  countryPacks: unknown;
  rulesets: unknown;
  legalValues: unknown;
  pendingCountryCode: string | null;
  busy: boolean;
  onSelectCountry: (countryCode: string) => void;
  onCommand: (command: string, payload: UnknownRecord) => Promise<void>;
}) {
  const library = taxKnowledge.legal_library;
  const selectedCountry = taxKnowledge.selected_country_code;
  const selectedCountryName =
    taxKnowledge.countries.find((country) => country.code === selectedCountry)?.name || selectedCountry;
  const schemaMissing =
    !library.schema_applied || taxKnowledge.warnings.includes(LIBRARY_SCHEMA_NOT_APPLIED);
  const createDomain = enabledAction(library.allowed_actions, 'create_tax_domain');
  const createKind = enabledAction(library.allowed_actions, 'create_tax_legal_node_kind');
  const nodeKinds = library.node_kinds;
  const provenanceOptions = library.provenance_type_options;

  const [dialogKind, setDialogKind] = useState(null as DialogKind);
  const [formError, setFormError] = useState('');
  const [domainTitle, setDomainTitle] = useState('');
  const [kindLabel, setKindLabel] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceProvenance, setSourceProvenance] = useState('');
  const [sourceDomainId, setSourceDomainId] = useState('');
  const [nodeTitle, setNodeTitle] = useState('');
  const [nodeNumber, setNodeNumber] = useState('');
  const [nodeKindId, setNodeKindId] = useState('');
  const [nodeSourceId, setNodeSourceId] = useState('');
  const [nodeParentId, setNodeParentId] = useState('');
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleNodeId, setRuleNodeId] = useState('');
  const [linkRuleId, setLinkRuleId] = useState('');
  const [linkNodeId, setLinkNodeId] = useState('');
  const [unlinkId, setUnlinkId] = useState('');
  const [unlinkTitle, setUnlinkTitle] = useState('');
  const [editDomainId, setEditDomainId] = useState('');
  const [editNodeId, setEditNodeId] = useState('');

  const closeDialog = () => {
    setDialogKind(null);
    setFormError('');
  };

  const openCreateDomain = () => {
    setDomainTitle('');
    setDialogKind('create_tax_domain');
  };
  const openCreateKind = () => {
    setKindLabel('');
    setDialogKind('create_tax_legal_node_kind');
  };
  const openCreateSource = (domainId: string) => {
    setSourceDomainId(domainId);
    setSourceTitle('');
    setSourceProvenance(provenanceOptions[0]?.value ?? '');
    setDialogKind('create_tax_source');
  };
  const openCreateNode = (source: OwnerLegalLibrarySource, parent?: OwnerLegalLibraryNode) => {
    setNodeSourceId(source.id);
    setNodeParentId(parent?.id ?? '');
    setNodeTitle('');
    setNodeNumber('');
    setNodeKindId(nodeKinds[0]?.id ?? '');
    setDialogKind('create_tax_legal_node');
  };
  const openCreateRule = (node: OwnerLegalLibraryNode) => {
    setRuleNodeId(node.id);
    setRuleTitle('');
    setDialogKind('create_tax_rule');
  };
  const openLinkRule = (node: OwnerLegalLibraryNode) => {
    setLinkNodeId(node.id);
    setLinkRuleId(library.unassigned_rules[0]?.id ?? taxKnowledge.rules[0]?.id ?? '');
    setDialogKind('link_tax_rule_legal_node');
  };
  const openUnlink = (linkId: string, title: string) => {
    setUnlinkId(linkId);
    setUnlinkTitle(title);
    setDialogKind('unlink_tax_rule_legal_node');
  };
  const openEditDomain = (id: string, title: string) => {
    setEditDomainId(id);
    setDomainTitle(title);
    setDialogKind('update_tax_domain_metadata');
  };
  const openEditNode = (node: OwnerLegalLibraryNode) => {
    setEditNodeId(node.id);
    setNodeTitle(node.title);
    setNodeNumber(node.node_number ?? '');
    setDialogKind('update_tax_legal_node_metadata');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCountry || !dialogKind) return;
    setFormError('');
    try {
      if (dialogKind === 'create_tax_domain') {
        await onCommand('create_tax_domain', { country_code: selectedCountry, title: domainTitle.trim() });
      } else if (dialogKind === 'create_tax_legal_node_kind') {
        await onCommand('create_tax_legal_node_kind', { country_code: selectedCountry, label: kindLabel.trim() });
      } else if (dialogKind === 'create_tax_source') {
        await onCommand('create_tax_source', {
          country_code: selectedCountry,
          title: sourceTitle.trim(),
          provenance_type: sourceProvenance,
          tax_domain_id: sourceDomainId,
        });
      } else if (dialogKind === 'create_tax_legal_node') {
        if (!nodeKindId) {
          setFormError('Add a structure type for this country first.');
          return;
        }
        const payload: UnknownRecord = {
          tax_source_id: nodeSourceId,
          tax_legal_node_kind_id: nodeKindId,
          title: nodeTitle.trim(),
        };
        if (nodeParentId) payload.parent_node_id = nodeParentId;
        if (nodeNumber.trim()) payload.node_number = nodeNumber.trim();
        await onCommand('create_tax_legal_node', payload);
      } else if (dialogKind === 'create_tax_rule') {
        await onCommand('create_tax_rule', {
          country_code: selectedCountry,
          title: ruleTitle.trim(),
          tax_legal_node_id: ruleNodeId,
        });
      } else if (dialogKind === 'link_tax_rule_legal_node') {
        await onCommand('link_tax_rule_legal_node', {
          tax_rule_id: linkRuleId,
          tax_legal_node_id: linkNodeId,
        });
      } else if (dialogKind === 'unlink_tax_rule_legal_node') {
        await onCommand('unlink_tax_rule_legal_node', { tax_rule_legal_node_id: unlinkId });
      } else if (dialogKind === 'update_tax_domain_metadata') {
        await onCommand('update_tax_domain_metadata', { tax_domain_id: editDomainId, title: domainTitle.trim() });
      } else if (dialogKind === 'update_tax_legal_node_metadata') {
        const payload: UnknownRecord = { tax_legal_node_id: editNodeId, title: nodeTitle.trim() };
        payload.node_number = nodeNumber.trim();
        await onCommand('update_tax_legal_node_metadata', payload);
      }
      closeDialog();
    } catch (err) {
      setFormError(userFacingApiMessage(err));
    }
  };

  const allSources = [
    ...library.domains.flatMap((domain) => domain.sources),
    ...library.unassigned_sources,
  ];
  const structureParentSource = findLegalLibrarySource(allSources, nodeSourceId);
  const structureParentNodes = structureParentSource ? flattenLegalLibraryNodes(structureParentSource.nodes) : [];
  const structureParentSourceLabel = structureParentSource?.title
    ? `${structureParentSource.title} (source)`
    : 'This legal source';
  const selectedKindLabel = nodeKinds.find((kind) => kind.id === nodeKindId)?.label ?? '';
  const structureItemPreview = legalStructureItemPreview(selectedKindLabel, nodeNumber, nodeTitle);

  const dialogTitle =
    dialogKind === 'create_tax_domain'
      ? 'Add Tax Domain'
      : dialogKind === 'create_tax_legal_node_kind'
        ? 'Add Structure Type'
        : dialogKind === 'create_tax_source'
          ? 'Add Legal Source'
          : dialogKind === 'create_tax_legal_node'
            ? 'Add Structure Item'
            : dialogKind === 'create_tax_rule'
              ? 'Add Canonical Rule'
              : dialogKind === 'link_tax_rule_legal_node'
                ? 'Link Existing Rule'
                : dialogKind === 'unlink_tax_rule_legal_node'
                  ? 'Unlink Rule'
                  : dialogKind === 'update_tax_domain_metadata'
                    ? 'Edit Tax Domain'
                    : dialogKind === 'update_tax_legal_node_metadata'
                      ? 'Edit Structure Item'
                      : '';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SectionCard>
        <h2 style={{ margin: 0, fontSize: 18 }}>Legal Library</h2>
        {!selectedCountry ? (
          <EmptyState title="Select a country" description="Choose a country to author its legal library." />
        ) : schemaMissing ? (
          <EmptyState
            title="Legal Library schema not applied"
            description="Migration 622 is required on DEV before domains, sources, and legal nodes can be authored."
          />
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {selectedCountryName ? (
              <div dir="auto" style={{ fontSize: 16, fontWeight: 600 }}>
                {selectedCountryName}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {createDomain ? (
                <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={openCreateDomain}>
                  + Add Tax Domain
                </button>
              ) : null}
              {createKind ? (
                <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={openCreateKind}>
                  Add Structure Type
                </button>
              ) : null}
              <button type="button" className="nx-btn nx-btn-taxes-compact" disabled title="Coming later">
                Upload material — Coming later
              </button>
            </div>
            {library.domains.length === 0 ? (
              <EmptyState title="No tax domains yet." description="Add a tax domain to start this country's legal library." />
            ) : nodeKinds.length ? (
              <p style={{ margin: 0, fontSize: 13, color: '#4b5563' }}>
                Structure types: {nodeKinds.map((kind) => kind.label).join(' · ')}
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
                Add structure types for this country before creating hierarchy items. The catalog is supplied by the
                backend for the selected country.
              </p>
            )}
            <div style={TREE_STYLE}>
              {library.domains.map((domain) => {
                const addSource = enabledAction(domain.allowed_actions, 'create_tax_source');
                const editDomain = enabledAction(domain.allowed_actions, 'update_tax_domain_metadata');
                return (
                  <div key={domain.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1 }}>
                        <div dir="auto" style={{ fontSize: 16, fontWeight: 700 }}>
                          {domain.title}
                        </div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{domain.status}</div>
                        <TechnicalDetails
                          rows={[
                            ['id', domain.id],
                            ['domain_code', domain.domain_code],
                          ]}
                        />
                      </div>
                      {editDomain ? (
                        <button
                          type="button"
                          className="nx-btn nx-btn-taxes-compact"
                          disabled={busy}
                          onClick={() => openEditDomain(domain.id, domain.title)}
                        >
                          Edit
                        </button>
                      ) : null}
                      {addSource ? (
                        <button
                          type="button"
                          className="nx-btn nx-btn-taxes-compact"
                          disabled={busy}
                          onClick={() => openCreateSource(domain.id)}
                        >
                          Add Legal Source
                        </button>
                      ) : null}
                    </div>
                    <div style={{ ...INDENT, marginTop: 10 }}>
                      {domain.sources.map((source) => (
                        <SourceBlock
                          key={source.id}
                          source={source}
                          onAddNode={(row) => openCreateNode(row)}
                          onAddChild={(node) => openCreateNode(source, node)}
                          onAddRule={openCreateRule}
                          onLinkRule={openLinkRule}
                          onUnlink={openUnlink}
                          onEditNode={openEditNode}
                          busy={busy}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SectionCard>

      {!schemaMissing && selectedCountry ? (
        <SectionCard>
          <h2 style={{ margin: 0, fontSize: 18 }}>Unassigned / Technical</h2>
          {library.unassigned_sources.length || library.unassigned_rules.length ? (
          <p style={{ marginTop: 0, fontSize: 13, color: '#4b5563' }}>
            Existing sources and rules that are not assigned to a tax domain or legal node. They are preserved and are
            not auto-assigned.
          </p>
          ) : (
            <EmptyState title="No unassigned records." description="Sources and rules appear here only when they are not yet placed in the legal library." />
          )}
          {library.unassigned_sources.map((source) => (
            <SourceBlock
              key={source.id}
              source={source}
              onAddNode={(row) => openCreateNode(row)}
              onAddChild={(node) => openCreateNode(source, node)}
              onAddRule={openCreateRule}
              onLinkRule={openLinkRule}
              onUnlink={openUnlink}
              onEditNode={openEditNode}
              busy={busy}
            />
          ))}
          {library.unassigned_rules.length ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Unassigned canonical rules</div>
              {library.unassigned_rules.map((rule) => (
                <div key={rule.id} dir="auto" style={{ fontSize: 13, padding: '4px 0' }}>
                  {rule.title}
                  <span style={{ color: '#6b7280' }}> · {rule.status}</span>
                  <details>
                    <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>Technical details</summary>
                    <div style={{ fontSize: 12 }}>
                      id: {rule.id}
                      <br />
                      rule_code: {rule.rule_code}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Technical registry</summary>
        <div style={{ marginTop: 12 }}>
          <OwnerTaxKnowledgePanel
            taxKnowledge={taxKnowledge}
            countryPacks={countryPacks}
            rulesets={rulesets}
            legalValues={legalValues}
            pendingCountryCode={pendingCountryCode}
            busy={busy}
            showCountryPicker={false}
            onSelectCountry={onSelectCountry}
            onCommand={onCommand}
          />
        </div>
      </details>

      {dialogKind ? (
        <div className="nx-modal-overlay" role="presentation" onClick={closeDialog}>
          <div
            className="nx-modal nx-accounting-editor-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <form onSubmit={(event) => void submit(event)}>
              <div className="nx-modal-header">
                <h2 className="nx-modal-title">{dialogTitle}</h2>
              </div>
              <div className="nx-modal-body">
                {formError ? <p style={{ color: '#b91c1c', fontSize: 13 }}>{formError}</p> : null}
                {dialogKind === 'create_tax_domain' || dialogKind === 'update_tax_domain_metadata' ? (
                  <label className="nx-field">
                    <span className="nx-field-label">Title</span>
                    <input className="nx-input" value={domainTitle} onChange={(e) => setDomainTitle(e.target.value)} dir="auto" required />
                  </label>
                ) : null}
                {dialogKind === 'create_tax_legal_node_kind' ? (
                  <label className="nx-field">
                    <span className="nx-field-label">Structure type label</span>
                    <input className="nx-input" value={kindLabel} onChange={(e) => setKindLabel(e.target.value)} dir="auto" required />
                  </label>
                ) : null}
                {dialogKind === 'create_tax_source' ? (
                  <div className="nx-form-grid">
                    <label className="nx-field">
                      <span className="nx-field-label">Title</span>
                      <input className="nx-input" value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)} dir="auto" required />
                    </label>
                    <label className="nx-field">
                      <span className="nx-field-label">Provenance</span>
                      <select className="nx-select" value={sourceProvenance} onChange={(e) => setSourceProvenance(e.target.value)}>
                        {provenanceOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                {dialogKind === 'create_tax_legal_node' || dialogKind === 'update_tax_legal_node_metadata' ? (
                  <div className="nx-form-grid">
                    {dialogKind === 'create_tax_legal_node' ? (
                      <label className="nx-field">
                        <span className="nx-field-label">Structure type</span>
                        <select className="nx-select" value={nodeKindId} onChange={(e) => setNodeKindId(e.target.value)} required>
                          <option value="">Select type</option>
                          {nodeKinds.map((kind) => (
                            <option key={kind.id} value={kind.id}>
                              {kind.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label className="nx-field">
                      <span className="nx-field-label">Number / identifier</span>
                      <input className="nx-input" value={nodeNumber} onChange={(e) => setNodeNumber(e.target.value)} dir="auto" />
                    </label>
                    <label className="nx-field">
                      <span className="nx-field-label">Official title</span>
                      <input className="nx-input" value={nodeTitle} onChange={(e) => setNodeTitle(e.target.value)} dir="auto" required />
                    </label>
                    {dialogKind === 'create_tax_legal_node' ? (
                      <label className="nx-field">
                        <span className="nx-field-label">Parent</span>
                        <select className="nx-select" value={nodeParentId} onChange={(e) => setNodeParentId(e.target.value)}>
                          <option value="">{structureParentSourceLabel}</option>
                          {structureParentNodes.map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {dialogKind === 'create_tax_legal_node' && structureItemPreview ? (
                      <p dir="auto" style={{ margin: 0, fontSize: 13, color: '#374151' }}>
                        Result: {structureItemPreview}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {dialogKind === 'create_tax_rule' ? (
                  <label className="nx-field">
                    <span className="nx-field-label">Title</span>
                    <input className="nx-input" value={ruleTitle} onChange={(e) => setRuleTitle(e.target.value)} dir="auto" required />
                  </label>
                ) : null}
                {dialogKind === 'link_tax_rule_legal_node' ? (
                  <label className="nx-field">
                    <span className="nx-field-label">Canonical rule</span>
                    <select className="nx-select" value={linkRuleId} onChange={(e) => setLinkRuleId(e.target.value)} required>
                      <option value="">Select rule</option>
                      {taxKnowledge.rules.map((rule) => (
                        <option key={rule.id} value={rule.id}>
                          {rule.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {dialogKind === 'unlink_tax_rule_legal_node' ? (
                  <p style={{ fontSize: 14, margin: 0 }} dir="auto">
                    Unlink “{unlinkTitle}” from this legal node? The canonical rule is not deleted.
                  </p>
                ) : null}
              </div>
              <div className="nx-modal-footer nx-tax-nested-modal-footer" style={{ justifyContent: 'center' }}>
                <button type="submit" className="nx-btn nx-btn-taxes-compact" disabled={busy} style={{ minWidth: 96 }}>
                  Save
                </button>
                <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={closeDialog} style={{ minWidth: 96 }}>
                  Close
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
