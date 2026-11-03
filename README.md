# Stash Alert

Indicador en la barra de estado para Devin Desktop / VS Code / Windsurf:
avisa en **rojo** cuando el branch actual tiene stashes de git.

Código: https://github.com/franciscoarnaldog/stash-alert

## Qué hace

- Muestra `$(git-stash) N stashes` en la barra de estado (abajo a la izquierda).
- Con 1 o más stashes en el repo: **fondo rojo** (`statusBarItem.errorBackground`).
  Por defecto cuenta **todos** los stashes (un stash casi siempre se crea para llevarlo
  a otro branch); con `stashAlert.scope: "branch"` cuenta solo los creados en el branch actual.
- Sin stashes: mismo texto, sin rojo (o oculto, según configuración).
- Clic en el indicador: lista los stashes con mensaje, ref (`stash@{N}`), antigüedad y branch.
  Desde ahí: **Apply**, **Pop**, **Descartar (drop)** o copiar el mensaje.
- Refresca solo: cada 10 s (configurable), al enfocar la ventana y al cambiar de workspace.
- Soporta multi-root: suma los stashes de todos los repos abiertos y los agrupa en el tooltip.

## Branch de cada stash

Git no asocia stashes a branches: son un stack global (`refs/stash`), pero cada stash guarda
en su mensaje el branch donde se creó (`On mi-branch: ...` / `WIP on mi-branch: ...`).
La extensión usa ese dato para mostrarlo en la lista y, con `stashAlert.scope: "branch"`,
para filtrar contra el branch actual (`git rev-parse --abbrev-ref HEAD`; en detached HEAD,
`(no branch)`).

## Configuración

| Setting | Default | Descripción |
|---|---|---|
| `stashAlert.scope` | `all` | `all`: todos los stashes del repo. `branch`: solo los creados en el branch actual. |
| `stashAlert.pollSeconds` | `10` | Intervalo de refresco en segundos (mínimo 3). |
| `stashAlert.hideWhenEmpty` | `false` | Ocultar el indicador cuando no hay stashes. |

## Comandos

- `Stash Alert: ver stashes`
- `Stash Alert: refrescar`

## Instalación

Desde un VSIX (ver README de la carpeta contenedora):

```
devin-desktop --install-extension stash-alert-0.1.1.vsix
```

y recargar la ventana. En otra PC con otro IDE, el mismo comando con su CLI
(`windsurf`, `code`, etc.).

## Notas

- No usa dependencias externas: solo la API de VS Code y el binario `git` del PATH.
- Las acciones Apply/Pop pueden generar conflictos como cualquier `git stash`;
  el error de git se muestra en una notificación.
