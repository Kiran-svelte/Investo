import React from 'react';
import { Link } from 'react-router-dom';
import { GitBranch, Loader2, Plus, Trash2, Users } from 'lucide-react';
import { dashboardPath } from '../../config/navigation.config';
import { useAuth } from '../../context/AuthContext';
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

function sumMemberCounts(nodes: BranchNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += node.member_count || 0;
    if (node.children?.length) {
      total += sumMemberCounts(node.children);
    }
  }
  return total;
}

const BranchesPage: React.FC = () => {
  const { user } = useAuth();
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
  const totalMembers = sumMemberCounts(tree);
  const branchesEnabled = user?.org_branches_enabled !== false;

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
    if (!window.confirm(`Delete branch "${branch.name}"? Team members must be reassigned first.`)) return;
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

      <section className="rounded-xl border border-brand-200 bg-brand-50/60 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-800">How branches work</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-brand-950">
          <li>Create a top-level branch (region or office), optionally add child branches (teams or sub-offices).</li>
          <li>
            Open{' '}
            <Link to={dashboardPath('/agents')} className="font-semibold underline underline-offset-2">
              Team
            </Link>{' '}
            and assign each sales or operations user to a branch.
          </li>
          <li>
            Operations and viewer roles only see leads, visits, and analytics for agents in their branch (including child branches).
          </li>
          <li>Company admins see everything and can filter any list by branch.</li>
        </ol>
        {!branchesEnabled ? (
          <p className="mt-3 text-sm text-amber-900">
            Branch scoping is pending platform activation. You can still create branches and assign team members; set{' '}
            <code className="rounded bg-white/80 px-1">FEATURE_ORG_BRANCHES=true</code> on the backend to enforce scoped views.
          </p>
        ) : null}
      </section>

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

      <div className="flex flex-wrap items-center gap-4 text-sm text-ink-muted">
        <span>{flat.length} branch{flat.length === 1 ? '' : 'es'}</span>
        <span className="inline-flex items-center gap-1">
          <Users className="h-4 w-4" />
          {totalMembers} assigned team member{totalMembers === 1 ? '' : 's'}
        </span>
        <Link
          to={dashboardPath('/agents')}
          className="font-semibold text-brand-700 hover:text-brand-800"
        >
          Manage team assignments →
        </Link>
      </div>

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
                  <p className="text-xs text-ink-muted">
                    {depth === 0 ? 'Top level' : 'Child branch'}
                    {' · '}
                    {(node.member_count || 0)} member{(node.member_count || 0) === 1 ? '' : 's'}
                  </p>
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
