# Ginkgo Connect

Plataforma comercial para conectar qualquer LLM compatível a APIs, webhooks, servidores MCP e sistemas empresariais de forma ultra simplificada.

**Status:** produto oficial em desenvolvimento  
**Repositório canônico:** `ginkgoai/ginkgo-connect`  
**Kernel:** Ginkgo Tree  
**Licença:** proprietária comercial

> O usuário descreve uma intenção. Connect identifica a ferramenta necessária, configura a conexão, valida a tarefa real e aplica credenciais, permissões e limites adequados.

## Papel no ecossistema

```text
AI Stack — laboratório aberto Apache-2.0
        │
        ▼
Ginkgo Tree — autonomia, limites, credenciais e auditoria
        │
        └── Connect — intention-to-tool connectivity
```

## Promessa do produto

```text
"Conecte esta IA ao meu CRM para consultar clientes e criar tarefas."
                         │
                         ▼
Connect
  1. entende a intenção;
  2. identifica API, MCP ou conector;
  3. solicita apenas credenciais e escopos necessários;
  4. configura e testa a conexão;
  5. demonstra a tarefa funcionando;
  6. registra limites, auditoria e health checks.
```

O produto deve reduzir uma integração técnica complexa a um onboarding guiado e verificável.

## Escopo principal

- conexão de LLMs e agentes compatíveis;
- catálogo de APIs, ferramentas, webhooks e servidores MCP;
- geração e configuração assistida de conectores;
- OAuth, API keys, tokens e escopos governados;
- descoberta de capacidades por intenção;
- mapeamento de intenção para ferramenta e ação;
- geração de schemas e contratos de entrada/saída;
- testes automáticos de autenticação e capacidade;
- validação da tarefa solicitada pelo usuário;
- read-only por padrão;
- aprovação para escrita, exclusão, pagamento e ações sensíveis;
- observabilidade, auditoria, retries e health checks;
- adaptadores para CRM, agenda, e-mail, arquivos, bancos, BI, ERP e sistemas próprios;
- implantação dedicada ou white-label mediante contrato.

## Fronteira de responsabilidades

### Connect contém

- entendimento e decomposição da intenção de integração;
- catálogo e descoberta de capacidades;
- contratos e adaptadores de APIs e MCPs;
- gerador e configurador de conectores;
- UX de onboarding, teste, diagnóstico e validação;
- workers de sincronização e execução específica;
- políticas específicas de integração;
- testes, documentação e deploy da edição.

### Ginkgo Tree contém

- autenticação, organizações, RBAC e multi-tenancy;
- agent runtime, autonomia, approvals e auditoria;
- billing, metering, orçamento e carteira de tokens;
- secrets boundary e leases temporários de credenciais;
- Laplace para documentação de APIs, schemas, contexto e memória;
- white-label, temas, domínios e componentes compartilhados.

Connect deve consumir pacotes privados versionados `@ginkgo/*`; o kernel não deve ser copiado para este repositório.

## Arquitetura de alto nível

```text
Usuário / LLM / Agente
          │ intenção
          ▼
Connect Planner
  ├── descobre capacidade
  ├── escolhe API / MCP / webhook
  ├── cria configuração
  ├── valida credencial e schema
  └── executa teste funcional
          │
          ├──► Ginkgo Tree policy and secrets boundary
          ├──► Laplace API knowledge
          ├──► connector workers
          └──► sistema externo autorizado
```

## Princípios

1. **Intenção antes do conector:** o usuário descreve o resultado, não precisa conhecer a implementação.
2. **Validação real:** uma integração só está pronta após executar a tarefa contratada em ambiente autorizado.
3. **Read-only primeiro:** leitura é separada de mutação.
4. **Menor privilégio:** escopos e credenciais são mínimos por capacidade.
5. **Segredos fora do prompt:** credenciais são resolvidas na boundary.
6. **Produto não duplica kernel:** capacidades reutilizáveis retornam ao Ginkgo Tree.

## Repository layout

- `apps/api`: Fastify composition root and health endpoints.
- `apps/web`: onboarding and connector interface.
- `apps/worker`: validation, connector and synchronization workers.
- `packages/*`: framework-independent contracts and product boundaries.
- `infra/docker`: local PostgreSQL, Redis and MinIO services.
- `docs`: architecture, operations and extraction provenance.

## Foundation gates

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config
docker compose up -d --wait
docker compose ps
```

Copy `.env.example` to `.env` only for local development. Example values must never be used in shared or production environments.

## Desenvolvimento

- comportamento compartilhado → `ginkgo-tree`;
- conexão intenção→ferramenta → `ginkgo-connect`;
- exemplo genérico sanitizado → `ai-stack`.

Nunca versione tokens OAuth, credenciais, payloads reais, dados de clientes, exports de produção ou endpoints internos.

## Licença

Este software é proprietário e comercial. Uso, implantação, hospedagem, distribuição, white-label, OEM ou acesso ao código dependem de autorização escrita da Ginkgo AI Systems.

Consulte [`LICENSE`](LICENSE).
