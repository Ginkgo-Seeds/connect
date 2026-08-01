# Ginkgo Connect

Plataforma comercial de integrações governadas, conectores, APIs e servidores MCP para conectar agentes de IA a sistemas empresariais.

**Status:** produto oficial em desenvolvimento  
**Repositório canônico:** `ginkgoai/ginkgo-connect`  
**Kernel:** Ginkgo Tree  
**Licença:** proprietária comercial

> Connect é uma distribuição vertical do Ginkgo Tree. Este repositório contém catálogo de conectores, validação de capacidades, configuração de integrações e políticas de acesso. Identidade, tenancy, billing, auditoria, secrets boundary e white-label pertencem ao kernel compartilhado.

## Papel no ecossistema

```text
AI Stack — laboratório aberto Apache-2.0
        │
        ▼
Ginkgo Tree — kernel comercial e white-label OS
        │
        └── Connect — integrações, APIs e MCP connectivity
```

## Escopo do produto

- catálogo de conectores e capacidades;
- onboarding guiado de integrações;
- APIs, webhooks e servidores MCP;
- OAuth, credenciais e escopos governados;
- testes de conexão e validação de tarefas;
- read-only por padrão;
- aprovação para escrita e ações sensíveis;
- observabilidade, auditoria e health checks;
- adaptadores para CRM, agenda, e-mail, dados e sistemas internos;
- implantação dedicada ou white-label mediante contrato.

## Fronteira de responsabilidades

### Este repositório contém

- contratos e adaptadores de conectores;
- catálogo de ferramentas e capacidades;
- UX de configuração, validação e diagnóstico;
- políticas específicas de integração;
- workers e filas de sincronização;
- testes, documentação e deploy da edição.

### Ginkgo Tree contém

- autenticação, organizações, RBAC e multi-tenancy;
- billing, metering e carteira de tokens;
- agent runtime, approvals, auditoria e evidências;
- secrets boundary e leases de credenciais;
- white-label, temas, domínios e componentes compartilhados.

Connect deve consumir pacotes privados versionados do namespace `@ginkgo/*`. Não copie o kernel para este repositório.

## Arquitetura de alto nível

```text
Usuário / Administrador
          │
          ▼
Connect Web ──► catálogo e configuração
                    │
                    ├──► Ginkgo Tree kernel
                    ├──► credential boundary
                    ├──► connector workers
                    ├──► APIs / MCP / webhooks
                    └──► sistemas externos autorizados
```

## Princípios

1. **Read-only primeiro:** leitura é separada de mutação.
2. **Menor privilégio:** escopos e credenciais são mínimos por capacidade.
3. **Validação real:** uma integração só é considerada pronta depois de testar a tarefa contratada.
4. **Segredos não transitam em prompts:** credenciais são resolvidas na boundary.
5. **Ações sensíveis exigem aprovação:** escrita, exclusão, pagamento e publicação seguem políticas.
6. **Produto não duplica kernel:** capacidades reutilizáveis retornam ao Ginkgo Tree.

## Repository layout

- `apps/api`: Fastify composition root and technical health endpoint.
- `apps/web`: Next.js product interface.
- `apps/worker`: connector and synchronization workers.
- `packages/*`: framework-independent contracts and product boundaries.
- `infra/docker`: local PostgreSQL, Redis and MinIO services.
- `docs`: architecture decisions, operations and extraction provenance.

## Requirements

- Node.js 24.14.0
- pnpm 11.17.0
- Docker with Compose

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

See [local development](docs/operations/local-development.md) for health verification and service endpoints.

## Desenvolvimento

- comportamento reutilizável por várias edições → `ginkgo-tree`;
- comportamento exclusivo de integrações/MCP → `ginkgo-connect`;
- exemplo genérico e sanitizado → `ai-stack`.

Nunca versione tokens OAuth, credenciais, payloads reais, dados de clientes, exports de produção ou endpoints internos.

## Licença

Este software é proprietário e comercial. Uso, implantação, hospedagem, distribuição, white-label, OEM ou acesso ao código dependem de autorização escrita da Ginkgo AI Systems.

Consulte [`LICENSE`](LICENSE).
