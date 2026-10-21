#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Resolve o caminho real do script mesmo quando aberto por um atalho (link
# simbólico) na área de trabalho — sem isso, $0 aponta pra pasta do atalho, não
# pra pasta real do projeto.
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
cd "$DIR"

echo "======================================"
echo "  Iniciando CRM VMCA..."
echo "======================================"

# Se já tiver rodando, não inicia de novo
if ! curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
  echo "Iniciando servidor..."
  cd "$DIR/server"
  nohup npm run dev > /tmp/vmca-server.log 2>&1 &
  disown
  cd "$DIR"
else
  echo "Servidor já estava rodando."
fi

if ! curl -s -o /dev/null http://localhost:5173 2>&1; then
  echo "Iniciando painel..."
  cd "$DIR/client"
  nohup npm run dev > /tmp/vmca-client.log 2>&1 &
  disown
  cd "$DIR"
else
  echo "Painel já estava rodando."
fi

echo "Aguardando os serviços subirem..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s http://localhost:3001/api/health > /dev/null 2>&1 && curl -s -o /dev/null http://localhost:5173 2>&1; then
    break
  fi
  sleep 1
done

echo "Abrindo o CRM no navegador..."
open "http://localhost:5173"

echo ""
echo "Pronto! O CRM está rodando. Pode fechar esta janela quando quiser —"
echo "ele continua rodando em segundo plano até você desligar/reiniciar o Mac."
echo ""
echo "Pressione qualquer tecla para fechar esta janela..."
read -n 1 -s
