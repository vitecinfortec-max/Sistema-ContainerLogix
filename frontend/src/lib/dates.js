// Datas no horário de quem usa o sistema (Brasília). `toISOString()` devolve
// UTC: usado pra "hoje"/"agora" adiantava 3 horas (e virava o dia depois das
// 21h). Aqui tudo é montado com a hora local do navegador.

const pad = (n) => String(n).padStart(2, '0');

const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Hoje, 'YYYY-MM-DD', para campos <input type="date">. */
export function todayISO() {
  return localDay(new Date());
}

/** Dia local de uma data ('YYYY-MM-DD'). */
export function toLocalDay(date) {
  return localDay(date);
}

/** Agora, 'YYYY-MM-DDTHH:mm', para campos <input type="datetime-local">. */
export function nowLocalInput() {
  const d = new Date();
  return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Data escolhida num <input type="date"> -> instante da meia-noite local, em
 * ISO. (`new Date('2026-10-14')` seria meia-noite UTC = 13/10 às 21h aqui.) */
export function dateInputToISO(value) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : null;
}

// Só o dia ('2026-10-14') ou meia-noite UTC exata ('2026-10-14T00:00:00Z'),
// formato em que Flex Tank, Revisão e Compra de Container gravavam a data
// escolhida até 2026-10-14: são o dia do calendário, não um instante.
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.0+)?(?:Z|\+00:00))?$/;

/** Date para exibir um campo de "data" (dia do calendário) sem cair no dia
 * anterior; outros valores (data/hora completa) seguem o new Date normal. */
export function calendarDate(value) {
  if (!value) return null;
  const m = CALENDAR_DAY.exec(String(value));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(value);
}

/** Valor de um campo de "data" para preencher um <input type="date">. */
export function toDateInput(value) {
  const d = calendarDate(value);
  return d && !Number.isNaN(d.getTime()) ? localDay(d) : '';
}
