import React from 'react';
import { GitBranch, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  createBranch,
  deleteBranch,
  listBranches,
  updateBranch,
  type BranchNode,
} from '../../services/identity';

function flattenBranches(nodes: BranchNode[], depth = 0): Array<{ node: BranchNode; depth: number }> {
  const rows: Array<{ node: BranchNode; depth: number }> = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.children?.length) {
      rows.push(...flattenBranches(node.children, depth + 1));
    }
  }
  return rows;
}

const BranchesPage: React.FC = () => {
  const [tree, setTree] = React.useState<BranchNode[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [newName, setNewName] = React.useState('');
  const [parentId, setParentId] = React.useState<string>('');
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTree(await listBranches());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load branches');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const flat = flattenBranches(tree);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createBranch({
        name: newName.trim(),
        parent_id: parentId || null,
      });
      setNewName('');
      setParentId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create branch');
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async (branch: BranchNode) => {
    const nextName = window.prompt('Branch name', branch.name);
    if (!nextName || nextName.trim() === branch.name) return;
    setSaving(true);
    setError(null);
    try {
      await updateBranch(branch.id, { name: nextName.trim() });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update branch');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (branch: BranchNode) => {
    if (!window.confirm(`Delete branch "${branch.name}"?`)) return;
    setSaving(true);
    setError(null);
    try {
      await deleteBranch(branch.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete branch');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-primary">Branches</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Model regions, offices, or teams with a two-level hierarchy.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      ) : null}

      <form onSubmit={handleCreate} className="rounded-xl border border-surface-border bg-white p-5">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-brand-700" />
          <h2 className="text-lg font-semibold text-ink-primary">Add branch</h2>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            className="investo-input"
            placeholder="Branch name"
            disabled={saving}
          />
          <select
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
            className="investo-input"
            disabled={saving}
          >
            <option value="">No parent (top level)</option>
            {flat.filter(({ depth }) => depth === 0).map(({ node }) => (
              <option key={node.id} value={node.id}>{node.name}</option>
            ))}
          </select>
          <button type="submit" disabled={saving || !newName.trim()} className="investo-btn-primary">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create branch
          </button>
        </div>
      </form>

      <section className="rounded-xl border border-surface-border bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-ink-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading branches…
          </div>
        ) : flat.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted">No branches yet. Create your first region or office above.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {flat.map(({ node, depth }) => (
              <li key={node.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div style={{ paddingLeft: `${depth * 1.25}rem` }}>
                  <p className="font-medium text-ink-primary">{node.name}</p>
                  <p className="text-xs text-ink-muted">{depth === 0 ? 'Top level' : 'Child branch'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-surface-border px-3 py-1.5 text-xs font-semibold text-ink-secondary"
                    onClick={() => void handleRename(node)}
                    disabled={saving}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700"
                    onClick={() => void handleDelete(node)}
                    disabled={saving}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default BranchesPage;
