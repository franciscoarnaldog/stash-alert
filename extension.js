const vscode = require('vscode');
const { execFile } = require('child_process');
const path = require('path');

let statusItem = null;
let pollTimer = null;
let lastSnapshot = [];

function activate(context) {
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusItem.name = 'Stash Alert';
    statusItem.command = 'stashAlert.showStashes';
    context.subscriptions.push(statusItem);

    context.subscriptions.push(
        vscode.commands.registerCommand('stashAlert.showStashes', showStashes),
        vscode.commands.registerCommand('stashAlert.refresh', refresh),
        vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('stashAlert')) {
                restartPolling();
                refresh();
            }
        }),
        vscode.window.onDidChangeWindowState(e => { if (e.focused) refresh(); })
    );

    restartPolling();
    refresh();
}

function deactivate() {
    if (pollTimer) clearInterval(pollTimer);
}

function restartPolling() {
    if (pollTimer) clearInterval(pollTimer);
    const cfg = vscode.workspace.getConfiguration('stashAlert');
    const secs = Math.max(3, Number(cfg.get('pollSeconds', 10)) || 10);
    pollTimer = setInterval(refresh, secs * 1000);
}

function gitRun(cwd, args) {
    return new Promise(resolve => {
        execFile('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({
                ok: !err,
                stdout: stdout || '',
                stderr: (stderr || (err && err.message) || '').trim()
            });
        });
    });
}

async function gitOrNull(cwd, args) {
    const r = await gitRun(cwd, args);
    return r.ok ? r.stdout : null;
}

function parseStashes(out) {
    const stashes = [];
    for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        const ref = parts[0] || '';
        const date = parts[1] || '';
        const subject = parts.slice(2).join('\t') || '';
        const m = /^(?:WIP on|On) (.+?): /.exec(subject);
        stashes.push({ ref, date, subject, branch: m ? m[1] : null });
    }
    return stashes;
}

async function collectSnapshot() {
    const folders = vscode.workspace.workspaceFolders || [];
    const seen = new Set();
    const snapshot = [];
    for (const folder of folders) {
        const rootOut = await gitOrNull(folder.uri.fsPath, ['rev-parse', '--show-toplevel']);
        const root = rootOut ? rootOut.trim() : null;
        if (!root || seen.has(root)) continue;
        seen.add(root);
        const branchOut = await gitOrNull(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
        if (branchOut === null) continue;
        const listOut = await gitOrNull(root, ['stash', 'list', '--format=%gd%x09%cr%x09%gs']);
        if (listOut === null) continue;
        snapshot.push({
            repo: path.basename(root),
            root,
            branch: branchOut.trim(),
            stashes: parseStashes(listOut)
        });
    }
    return snapshot;
}

function relevantStashes(entry, scope) {
    if (scope === 'all') return entry.stashes;
    const actual = entry.branch === 'HEAD' ? '(no branch)' : entry.branch;
    return entry.stashes.filter(s => s.branch === actual);
}

async function refresh() {
    if (!statusItem) return;
    const cfg = vscode.workspace.getConfiguration('stashAlert');
    const scope = cfg.get('scope', 'branch');
    const hideWhenEmpty = cfg.get('hideWhenEmpty', false);

    try {
        lastSnapshot = await collectSnapshot();
    } catch (e) {
        lastSnapshot = [];
    }

    if (!lastSnapshot.length) {
        statusItem.hide();
        return;
    }

    let total = 0;
    const lines = [];
    for (const entry of lastSnapshot) {
        const rel = relevantStashes(entry, scope);
        total += rel.length;
        if (rel.length) {
            lines.push(`**${entry.repo}** (${entry.branch}): ${rel.length}`);
            for (const s of rel) lines.push(`- ${s.ref} — ${s.subject} _(${s.date})_`);
        }
    }

    statusItem.text = `$(git-stash) ${total} stash${total === 1 ? '' : 'es'}`;
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**Stash Alert** — alcance: \`${scope}\`\n\n`);
    md.appendMarkdown(total > 0 ? lines.join('\n') : '_Sin stashes ' + (scope === 'branch' ? 'en el branch actual' : '') + '_');
    statusItem.tooltip = md;

    if (total > 0) {
        statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        statusItem.show();
    } else {
        statusItem.backgroundColor = undefined;
        if (hideWhenEmpty) {
            statusItem.hide();
        } else {
            statusItem.show();
        }
    }
}

const BTN_APPLY = { iconPath: null, tooltip: 'Aplicar' };
const BTN_POP = { iconPath: null, tooltip: 'Pop' };
const BTN_DROP = { iconPath: null, tooltip: 'Descartar' };

function ensureButtons() {
    if (!BTN_APPLY.iconPath) {
        BTN_APPLY.iconPath = new vscode.ThemeIcon('git-stash-apply');
        BTN_POP.iconPath = new vscode.ThemeIcon('git-stash-pop');
        BTN_DROP.iconPath = new vscode.ThemeIcon('trash');
    }
}

async function showStashes() {
    ensureButtons();
    await refresh();
    const cfg = vscode.workspace.getConfiguration('stashAlert');
    const scope = cfg.get('scope', 'branch');

    const items = [];
    for (const entry of lastSnapshot) {
        const rel = relevantStashes(entry, scope);
        if (!rel.length) continue;
        items.push({ label: `${entry.repo} — branch ${entry.branch}`, kind: vscode.QuickPickItemKind.Separator });
        for (const s of rel) {
            items.push({
                label: `$(git-stash) ${s.subject}`,
                description: `${s.ref} · ${s.date}`,
                detail: scope === 'all' ? `branch: ${s.branch || '(desconocido)'}` : `branch: ${s.branch || '(desconocido)'} · repo: ${entry.repo}`,
                stash: s,
                repo: entry
            });
        }
    }

    if (!items.length) {
        vscode.window.showInformationMessage('No hay stashes' + (scope === 'branch' ? ' en el branch actual.' : '.'));
        return;
    }

    const qp = vscode.window.createQuickPick();
    qp.title = 'Stash Alert';
    qp.placeholder = 'Elegí un stash: Enter abre el menú de acciones; los botones aplican/pop/descartan directo';
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.items = items;
    qp.buttons = [{ iconPath: new vscode.ThemeIcon('refresh'), tooltip: 'Refrescar' }];

    let handled = false;
    qp.onDidTriggerButton(() => {
        qp.hide();
        showStashes();
    });
    qp.onDidTriggerItemButton(({ item, button }) => {
        if (!item.stash) return;
        handled = true;
        qp.hide();
        if (button.tooltip === BTN_APPLY.tooltip) doStashAction(item.repo, item.stash, 'apply');
        else if (button.tooltip === BTN_POP.tooltip) doStashAction(item.repo, item.stash, 'pop');
        else if (button.tooltip === BTN_DROP.tooltip) doStashAction(item.repo, item.stash, 'drop');
    });
    qp.onDidChangeSelection(sel => {
        const item = sel[0];
        if (!item || !item.stash) return;
        handled = true;
        qp.hide();
        showActions(item.repo, item.stash);
    });
    qp.onDidHide(() => { qp.dispose(); });
    qp.show();
}

async function showActions(repoEntry, stash) {
    const acciones = [
        { label: '$(git-stash-apply) Aplicar (apply)', description: 'aplica los cambios sin eliminar el stash', act: 'apply' },
        { label: '$(git-stash-pop) Pop', description: 'aplica los cambios y elimina el stash', act: 'pop' },
        { label: '$(trash) Descartar (drop)', description: 'elimina el stash definitivamente', act: 'drop' },
        { label: '$(clippy) Copiar mensaje', description: 'copia el mensaje del stash al portapapeles', act: 'copy' }
    ];
    const sel = await vscode.window.showQuickPick(acciones, {
        title: 'Stash Alert',
        placeHolder: `${stash.ref} — ${stash.subject}`
    });
    if (!sel) return;
    if (sel.act === 'copy') {
        await vscode.env.clipboard.writeText(stash.subject);
        vscode.window.showInformationMessage('Mensaje copiado al portapapeles.');
        return;
    }
    doStashAction(repoEntry, stash, sel.act);
}

async function doStashAction(repoEntry, stash, action) {
    if (action === 'drop') {
        const ok = await vscode.window.showWarningMessage(
            `¿Descartar ${stash.ref} ("${stash.subject}")? No se puede deshacer.`,
            { modal: true },
            'Descartar'
        );
        if (ok !== 'Descartar') return;
    }
    const args = action === 'apply'
        ? ['stash', 'apply', stash.ref]
        : action === 'pop'
            ? ['stash', 'pop', stash.ref]
            : ['stash', 'drop', stash.ref];
    const r = await gitRun(repoEntry.root, args);
    if (r.ok) {
        const msg = action === 'apply'
            ? `Stash aplicado: ${stash.subject}`
            : action === 'pop'
                ? `Stash aplicado y eliminado: ${stash.subject}`
                : `Stash eliminado: ${stash.subject}`;
        vscode.window.showInformationMessage(msg);
    } else {
        vscode.window.showErrorMessage(`git stash ${action} falló: ${r.stderr.slice(0, 300)}`);
    }
    refresh();
}

module.exports = { activate, deactivate };
