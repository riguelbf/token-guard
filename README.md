<p align="center">
  <img src="./assets/token-guard-icon.svg" alt="Token Guard" width="144" />
</p>

# token-guard

Monitora e limita o custo diário de uso de tokens do **Claude Code** e **OpenAI/Codex**, bloqueando novas chamadas quando o limite é atingido e exigindo confirmação para continuar.

---

## Como funciona

- **Claude Code** — integração via hooks nativos (`PreToolUse` e `Stop`). O uso é registrado automaticamente ao final de cada resposta e novas ferramentas são bloqueadas se o limite for ultrapassado.
- **OpenAI / Codex** — integração via proxy HTTP local. O instalador escreve `~/.codex/config.toml` com `openai_base_url` para apontar ao proxy e grava `~/.token-guard/activation.txt` com a referência portátil da instalação. As chamadas `chat/completions`, `completions`, `embeddings` e `responses` passam pelo token-guard.
- O custo é calculado em USD com base nos preços oficiais por modelo (configurável).
- Os dados ficam em `~/.token-guard/` — por usuário, persistente entre sessões.

---

## Instalação

```bash
# Dentro do diretório do pacote
npm link

# Verifica se está disponível
token-guard --help
```

---

## Início rápido

```bash
# 1. Define o limite diário (padrão: $10)
token-guard limit 10

# 2. Instala os hooks no Claude Code
token-guard install

# 3. Inicia o proxy para OpenAI/Codex
token-guard proxy start

# 4. O instalador configura o Codex automaticamente via ~/.codex/config.toml
#    e grava ~/.token-guard/activation.txt com os detalhes portáveis
```

---

## Cenários de uso

### Ver o uso do dia

```bash
token-guard status
```

Saída:

```
  Token Guard  —  2026-03-25
  ────────────────────────────────────────────────────────────
  Provider      Input tkns    Output tkns   Cache tkns    Cost
  ────────────────────────────────────────────────────────────
  claude        45,000        12,000        5,000         $0.3165
  openai        10,000         3,000            0         $0.0550
  ────────────────────────────────────────────────────────────
  ████░░░░░░░░░░░░░░░░  $0.3715 / $10.0000  (3.7%)
  Remaining: $9.6285  |  Calls: 2

  OK
```

---

### Limite atingido — desbloquear elevando o limite

Quando o limite é atingido, o Claude Code exibe:

```
Daily token cost limit reached: $10.0032 of $10.00 used.
Run 'token-guard unlock [+usd]'  — raise the daily limit (default +$5)
Run 'token-guard disable'        — turn off the guard entirely
```

Para continuar, eleve o limite diretamente do terminal do Claude Code:

```bash
# Eleva em $5 (padrão)
token-guard unlock

# Eleva em valor específico
token-guard unlock 20
```

O comando pede confirmação antes de alterar:

```
Today's usage : $10.0032
Current limit : $10.00
New limit     : $15.00  (+$5)
Confirm? [y/N]
```

O tracking continua preciso — o limite sobe, o uso acumulado não é perdido.

---

### Desligar a trava temporariamente

```bash
# Desliga completamente (sem bloqueios)
token-guard disable

# Reativa
token-guard enable
```

---

### Ver histórico dos últimos dias

```bash
token-guard history        # 7 dias
token-guard history 30     # 30 dias
```

---

### Alterar o limite diário

```bash
token-guard limit 25
```

---

### Resetar o uso do dia atual

```bash
token-guard reset
```

---

### Proxy OpenAI — gerenciamento

```bash
token-guard proxy start    # inicia em background
token-guard proxy stop     # para o proxy
token-guard proxy status   # mostra PID e porta
```

O proxy roda em `http://127.0.0.1:4141` por padrão. Para mudar a porta:

```bash
# Edite ~/.token-guard/config.json
# "proxy_port": 8080
```

---

### Uso com Codex CLI

```bash
export OPENAI_BASE_URL=http://127.0.0.1:4141/v1
codex "refatore este arquivo para TypeScript"
```

### Uso com SDK Node.js / Python

```js
// Node.js — basta ter OPENAI_BASE_URL no ambiente
const openai = new OpenAI(); // usa OPENAI_BASE_URL automaticamente
```

```python
# Python
import openai
# basta ter OPENAI_BASE_URL exportado
```

---

### Registro manual de uso

Útil para scripts próprios ou integrações customizadas:

```bash
token-guard track \
  --provider=openai \
  --model=gpt-4o \
  --input=1500 \
  --output=800
```

---

### Verificação em scripts CI/CD

```bash
token-guard check || { echo "Limite diário atingido"; exit 1; }
```

---

## Referência de comandos

| Comando | Descrição |
|---|---|
| `token-guard status` | Uso do dia com barra de progresso |
| `token-guard history [dias]` | Histórico (padrão: 7 dias) |
| `token-guard limit <usd>` | Define o limite diário em USD |
| `token-guard unlock [+usd]` | Eleva o limite diário (padrão: +$5) |
| `token-guard disable` | Desliga a trava completamente |
| `token-guard enable` | Reativa a trava |
| `token-guard reset` | Zera o uso do dia atual |
| `token-guard install` | Instala hooks no Claude Code e a config portátil do Codex |
| `token-guard uninstall` | Remove hooks do Claude Code e a config portátil do Codex |
| `token-guard proxy start` | Inicia o proxy OpenAI em background |
| `token-guard proxy stop` | Para o proxy |
| `token-guard proxy status` | Status do proxy |
| `token-guard track --provider= --model= --input= --output=` | Registra uso manualmente |
| `token-guard check` | Exit 1 se bloqueado, 0 se OK |
| `token-guard config` | Exibe a configuração atual |

---

## Modelos suportados e custos padrão

Os custos são configuráveis em `~/.token-guard/config.json` (USD por 1M tokens).

| Modelo | Input | Output | Cache read |
|---|---|---|---|
| claude-opus-4-6 | $15 | $75 | $1.50 |
| claude-sonnet-4-6 | $3 | $15 | $0.30 |
| claude-haiku-4-5 | $0.80 | $4 | $0.08 |
| gpt-4o | $2.50 | $10 | — |
| gpt-4o-mini | $0.15 | $0.60 | — |
| o1 | $15 | $60 | — |
| o3 | $10 | $40 | — |
| codex-mini-latest | $1.50 | $6 | — |

Para adicionar ou ajustar um modelo:

```json
// ~/.token-guard/config.json
{
  "models": {
    "meu-modelo-customizado": { "input": 1.0, "output": 3.0 }
  }
}
```

---

## Dados e privacidade

Todos os dados ficam localmente em `~/.token-guard/`:

```
~/.token-guard/
├── activation.txt       # referência portátil da instalação
├── config.json          # configurações e limites
├── proxy.pid            # PID do proxy (quando ativo)
└── usage/
    ├── 2026-03-25.json  # uso do dia
    └── 2026-03-26.json
```

Nenhum dado é enviado a servidores externos. O proxy apenas encaminha as requisições ao destino original (OpenAI).

---

## Limitações conhecidas

- **Extensões de editor** (GitHub Copilot, Cursor): a maioria tem o endpoint hardcoded e não respeita `OPENAI_BASE_URL`. O proxy não intercepta essas chamadas. Para esses casos, a integração continua sendo por configuração específica do app.
- **Streaming com uso**: o proxy só registra tokens quando a resposta inclui o campo `usage` no stream. Em clientes que usam `stream: true`, configure `stream_options: { include_usage: true }` para garantir o rastreamento.
- **Claude Code**: o bloqueio ocorre no início do próximo turno (PreToolUse), não no meio de uma resposta em andamento.
