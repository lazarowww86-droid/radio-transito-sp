RÁDIO TRÂNSITO SP — VALIDAÇÃO DA ATUALIZAÇÃO ARTESP

A resposta real observada no serviço r3 foi HTTP 200 da ARTESP, com 1 registro e timestamp sem fuso. O bloqueio vinha da validação de horário no adaptador. A revisão r4 compara o relógio local do JSON com o Date HTTP convertido para São Paulo antes de aceitar a resposta.

Os 32 testes do serviço e 53 verificações do site passaram. No navegador, a reprodução usou os MP3s do projeto; a previsão, a resposta de trânsito e a voz foram simuladas. A confirmação final da resposta real depende da publicação da revisão r4.

Resultados de navegador:
- MP3 real: play, pausa e retomada no mesmo ponto.
- 40 trocas naturais de MP3: duas seleções completas, sem repetição dentro de cada ciclo.
- Fonte automática, horário da resposta e boletim de trânsito retomam o MP3 real.
- Podcast no horário, entrada no ponto da transmissão e boletim retomando o mesmo MP3.
- Repetição do mesmo episódio ao meio-dia, pular não reinicia e outro episódio no dia seguinte.
- Interface, módulos novos e música pré-carregada continuam disponíveis offline.

40 transições ended -> playing: mínimo 2 ms, máximo 12 ms, mediana 3 ms, com áudios locais pré-carregados. Isso não mede o tempo de download na internet.
Erros JavaScript: 0.
Desktop 1440 px e celular 390 px verificados sem rolagem horizontal.

28 MP3s mantidos byte a byte. Módulos programming.js, music-tracks.js e weather.js sem alterações.
