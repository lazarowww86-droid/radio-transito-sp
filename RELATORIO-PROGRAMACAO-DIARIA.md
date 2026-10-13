# Rádio Trânsito SP — programação diária

Versão: 20261013-r5-daily. Data: 13/10/2026.

## Resultado

- 20 músicas com título e artista. Os MP3s conservam os nomes e os bytes anteriores; apenas o catálogo exibido muda.
- Seleção aleatória sem repetir uma música antes de completar as 20; sem repetição imediata na mudança de seleção. O histórico atende Anterior/Próximo.
- Um dos quatro podcasts por dia, repetido às 06:30, 12:00 e 18:30. A mudança diária usa o calendário de São Paulo e uma âncora fixa, permitindo que o mesmo dia tenha o mesmo episódio para todos os ouvintes.
- Durante a transmissão, novos ouvintes entram no ponto do horário. Após o podcast, retorna a música. Pular a transmissão não reinicia o podcast no próximo ciclo do relógio.
- Pré-carregamento das próximas duas músicas e antecipação do próximo podcast, mantendo os dois elementos de áudio já usados.
- Voz do tempo: seleção persistente e preferência por voz masculina Natural/Neural disponível no dispositivo. Não foi incluída voz gravada nova; a geração foi bloqueada automaticamente.
- Atualização do cache da interface, preservando o cache dos áudios.

## Validação

46 testes/grupos automatizados: 16 do player, 15 da previsão, 8 da grade/voz, 2 da música e 5 do service worker.

Chromium 150.0.7871.124, com os MP3s reais servidos localmente:

- Play, pausa e retomada no mesmo ponto.
- 40 fins de faixa naturais, passando por duas seleções completas das 20 músicas. Foi antecipado o ponto de reprodução para o fim de cada arquivo, sem disparar eventos ended artificiais.
- Intervalo medido do evento ended ao evento playing da próxima faixa: mínimo 1 ms, máximo 9 ms, mediana 3 ms. Essa medição é local, com pré-carregamento; conexão e aparelho podem alterar o tempo em uso real. O tempo de espera do script após buscar o final de um MP3 inclui a própria busca e não foi usado como intervalo entre faixas.
- Entrada de podcast no horário, seek de 5 minutos para entrada tardia, repetição do mesmo episódio ao meio-dia, avanço manual sem reinício e outro episódio no dia seguinte.
- Boletim de previsão que pausa e retoma o mesmo MP3; pausa do usuário cancela a fala.
- Interface e módulos novos disponíveis offline; música já em cache reproduzida offline.
- Interface verificada em 1440 px e 390 px, sem transbordamento horizontal. Nenhum erro JavaScript registrado.

Os dados meteorológicos e os eventos da voz foram simulados nos testes. Não se validou a disponibilidade ou a qualidade de uma voz Natural em aparelho físico. Não houve publicação no GitHub.

## Limites

A grade segue o relógio do aparelho. A página precisa permanecer aberta e o usuário precisa autorizar a reprodução pelo Play. Pausas ou boletins podem estender o término do podcast; a programação musical retoma após o final real do áudio.

A fonte de trânsito configurada anteriormente permanece preservada. Não foi criada uma nova conexão de trânsito nesta atualização.
