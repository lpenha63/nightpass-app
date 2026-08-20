# Evolution API — self-host (VPS ou Oracle Cloud Free)

Sobe a Evolution API + Postgres + Redis com **persistência** (a sessão do WhatsApp
não se perde ao reiniciar). Substitui o Railway.

## Pré-requisitos
- Um servidor Linux 24/7 (VPS Hetzner/Contabo/DigitalOcean **ou** uma VM Oracle Cloud "Always Free").
- Docker + Docker Compose instalados:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```

## Passos
1. Copie esta pasta (`deploy/evolution-api/`) para o servidor.
2. `cp .env.example .env` e edite o `.env`:
   - **`AUTHENTICATION_API_KEY`** = a MESMA chave já salva no NightPass (Configurações → WhatsApp → API Key, a de 8 caracteres). Assim o app segue funcionando sem trocar nada.
   - **`SERVER_URL`** = `http://SEU_IP:8080` (ou o domínio com https, se usar proxy).
   - **`POSTGRES_PASSWORD`** = uma senha forte.
3. Suba:
   ```bash
   docker compose up -d
   ```
4. Confira que está no ar:
   ```bash
   curl -s http://localhost:8080/ | head
   # e o estado da instância (troque a chave):
   curl -s http://localhost:8080/instance/connectionState/nightpass -H "apikey: SUA_CHAVE"
   ```

## Firewall
Libere a porta **8080** (VPS: no painel/UFW; Oracle: Security List + `iptables`/firewalld da VM).
Oracle costuma bloquear por padrão — libere TCP 8080 na *Ingress Rule* da subnet **e** na VM:
```bash
sudo iptables -I INPUT -p tcp --dport 8080 -j ACCEPT
```

## Ligar ao NightPass
- Se a URL/instância mudaram, atualize em **NightPass → Configurações → WhatsApp**:
  - API URL = seu `SERVER_URL`
  - Instance Name = `nightpass` (mesmo de antes)
  - API Key = a mesma chave do `.env`
- Salve, clique em reconectar e **escaneie o QR** (a primeira conexão sempre pede).
- Teste o envio pelo botão de teste (agora com mensagens de erro claras).

## Recomendado: HTTPS
Pra produção, coloque um proxy (Caddy/Nginx) na frente com domínio + TLS e aponte
`SERVER_URL` para `https://evolution.seudominio.com`. O Caddy resolve o certificado sozinho:
```
evolution.seudominio.com {
    reverse_proxy localhost:8080
}
```

## Manutenção
- Ver logs: `docker compose logs -f evolution-api`
- Atualizar: `docker compose pull && docker compose up -d`
- Backup: os volumes `postgres_data`, `redis_data`, `evolution_instances` guardam tudo.
