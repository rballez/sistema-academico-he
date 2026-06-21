/* renderer.js — Versión 1.0.0 (Completa y Depurada) */
'use strict';

let allAlumnos = [], allUniversidades = [], rotGuardiaCsv = null, examGuardiaCsv = null, rotGuardiaPath = null, examGuardiaPath = null, chartUniv = null, chartDist = null;
let examPreviewLote = [];
let cacheDataGlobal = [];
let cacheDataMega = [];
let calGrado = '';
let rotGrado = '';
let resGradoActual = 'MIP 1';
let resSortCol = null; // 'mip1' | 'mip2' | null
let resSortDir = 'desc'; // 'asc' | 'desc'
let cacheResultados = [];

const cMap = { 'GyO': 'var(--c-gyo)', 'Pediatría': 'var(--c-pedia)', 'Cirugía': 'var(--c-ciru)', 'Medicina Interna': 'var(--c-mi)', 'Urgencias': 'var(--c-urg)', 'Familiar': 'var(--c-fam)' };
const MAPA_LOGOS = { 'ANÁHUAC': 'ANAH', 'ANAHUAC': 'ANAH', 'ANÁHUAC NORTE': 'ANAH', 'BUAP': 'BUAP', 'ANÁHUAC SUR': 'BUAP', 'IPN': 'IPN', 'ESM/IPN': 'IPN', 'LA SALLE CDMX': 'LSALLE', 'LA SALLE VICTORIA': 'LSALLE', 'MONTRER': 'MONT', 'SAINT LUKE': 'STLK', 'UAEH': 'UAEH', 'UNAM': 'UNAM', 'UNSA': 'UNSA', 'WESTHILL': 'WEST', 'TOMINAGA NAKAMOTO': 'TOMI', 'EXTRANJEROS': 'EXTRANJEROS', 'INTERCAMBIO': 'INTERCAMBIO', 'UNAM FES ZARAGOZA': 'UNAM', 'OTROS': 'OTR' };

document.addEventListener('DOMContentLoaded', async () => {
  if (navigator.platform.includes('Mac')) document.body.classList.add('platform-darwin');
  await initDB(); await checkAuth(); 
});

async function py(action, payload = {}) { try { return await window.api.py(action, payload); } catch (e) { return { ok: false, error: e.message }; } }
async function initDB() { await py('init_db'); }

// ── SEGURIDAD (CONTRASEÑA) ──
async function checkAuth() {
  // Ocultar ambos paneles antes del check (evita estado residual al reabrir en macOS)
  document.getElementById('auth-login').style.display = 'none';
  document.getElementById('auth-setup').style.display = 'none';
  document.getElementById('auth-error').textContent = '';

  const r = await py('auth_check');
  if (!r.ok || r.data === undefined) {
    // Error de comunicación con Python (ej. proceso recién iniciado). 
    // Reintentar después de un momento en lugar de mostrar setup por error.
    setTimeout(checkAuth, 600);
    return;
  }
  if (r.data?.has_password) {
    document.getElementById('auth-pwd').value = '';
    document.getElementById('auth-login').style.display = 'block';
  } else {
    document.getElementById('auth-new-pwd').value = '';
    document.getElementById('auth-new-pwd-conf').value = '';
    document.getElementById('auth-setup').style.display = 'block';
  }
}
async function setupPassword() {
  const p1 = document.getElementById('auth-new-pwd').value, p2 = document.getElementById('auth-new-pwd-conf').value;
  if (!p1 || p1 !== p2) return alert("Las contraseñas no coinciden o están vacías.");
  const r = await py('auth_setup', { pwd: p1 });
  if (r.ok) { document.getElementById('auth-screen').style.display = 'none'; arrancarSistema(); }
}
async function loginApp() {
  const p = document.getElementById('auth-pwd').value, r = await py('auth_login', { pwd: p });
  if (r.data?.valid) { document.getElementById('auth-screen').style.display = 'none'; arrancarSistema(); } 
  else document.getElementById('auth-error').textContent = "Contraseña incorrecta";
}

async function arrancarSistema() {
  await cargarConfig(); setupNav();
  // Restaurar estado de checkboxes troncal/remedial desde localStorage
  const tr = localStorage.getItem('he_troncal');
  const rem = localStorage.getItem('he_remedial');
  if (tr !== null) document.getElementById('check-troncal').checked = tr === '1';
  if (rem !== null) document.getElementById('check-remedial').checked = rem === '1';
  await cargarUniversidades(); await cargarAlumnos(); checkGradoSelect(); checkExamGradoSelect();
  actualizarBotonDeshacer();
}

function guardarCheckboxState() {
  localStorage.setItem('he_troncal', document.getElementById('check-troncal').checked ? '1' : '0');
  localStorage.setItem('he_remedial', document.getElementById('check-remedial').checked ? '1' : '0');
}

async function cargarConfig() {
  const r = await py('get_ciclo_actual'), ciclo = r.data?.ciclo || '—'; 
  document.getElementById('sidebar-cycle').textContent = `Ciclo: ${ciclo}`; document.getElementById('ciclo-hero').textContent = ciclo;
  const inp = document.getElementById('ciclo-input'); if (inp) inp.value = ciclo;
  aplicarTema((await py('get_config', { clave: 'tema', default: 'oscuro' })).data?.valor || 'oscuro');
  if ((await py('get_config', { clave: 'primer_inicio', default: '1' })).data?.valor === '1') checkWarningAlumnos();
}
async function seleccionarCarpeta(inputId) { const r = await window.api.openDirectory('Selecciona destino'); if (r) document.getElementById(inputId).value = r; }

function setupNav() { document.querySelectorAll('.sidebar-nav a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); goTo(a.dataset.section); })); }
function goTo(section) {
  document.querySelectorAll('.sidebar-nav li, .section').forEach(el => el.classList.remove('active'));
  const link = document.querySelector(`[data-section="${section}"]`); if (link) link.parentElement.classList.add('active');
  const sec = document.getElementById(`sec-${section}`); if (sec) sec.classList.add('active');
  document.getElementById('topbar-title').textContent = link?.dataset.title || link?.textContent.trim() || '';
  if (section === 'calificaciones') cargarTablaGlobal();
  if (section === 'escuelas') renderEscuelas();
  if (section === 'rotaciones') cargarAlertasDuplicados();
  if (section === 'examenes') { actualizarIndicadorExamenesEvaluados(); cargarExamenesConDatos(); }
}
function switchTab(btn, panelId) {
  const group = btn.closest('.tab-group'); group.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
  btn.closest('.section').querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none'); document.getElementById(`tab-${panelId}`).style.display = 'block';
}
function switchAlumnoTab(btn, tab) {
  document.querySelectorAll('#sec-alumnos .tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
  document.getElementById('tab-activos').style.display = tab === 'activos' ? 'block' : 'none'; document.getElementById('tab-egresados').style.display = tab === 'egresados' ? 'block' : 'none';
  if (tab === 'egresados') cargarEgresados();
}
function toast(msg, type='success', dur=3500) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const c = document.getElementById('toast-container'), el = document.createElement('div'); el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || '⚠️'}</span><span class="toast-msg">${msg}</span><span class="toast-close" onclick="this.parentElement.remove()">✕</span>`;
  c.appendChild(el); if (dur>0) setTimeout(() => el.remove(), dur);
}
function checkWarningAlumnos() {
  // Muestra el banner de aviso cuando la app inicia por primera vez (sin alumnos del ciclo nuevo)
  document.getElementById('warning-alumnos').classList.remove('hidden');
}
function showProgress(pct) { document.getElementById('progress-bar').classList.add('show'); document.getElementById('progress-inner').style.width = pct + '%'; if (pct >= 100) setTimeout(() => document.getElementById('progress-bar').classList.remove('show'), 500); }
function confirmDialog(title, msg, onOk, icon='⚠️') { document.getElementById('confirm-icon').textContent=icon; document.getElementById('confirm-title').textContent=title; document.getElementById('confirm-msg').innerHTML=msg; document.getElementById('confirm-overlay').classList.add('open'); document.getElementById('confirm-ok').onclick=()=>{closeModal('confirm-overlay'); onOk();}; }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function openModal(id) { document.getElementById(id).classList.add('open'); }
function gradePill(val) {
  if (val===null || val===undefined || val==='') return '<span class="grade-pill grade-np">NP</span>';
  const v = Math.floor(parseFloat(val) + 0.5); return `<span class="grade-pill ${v>=70?'grade-green':v>=60?'grade-yellow':'grade-red'}">${v}</span>`;
}

// ── UNIVERSIDADES Y ALUMNOS ──
async function cargarUniversidades() {
  allUniversidades = (await py('listar_universidades')).data?.universidades || [];
  const sel1 = document.getElementById('filter-escuela-al'), sel2 = document.getElementById('al-universidad'), sel3 = document.getElementById('filter-escuela-cal');
  sel1.innerHTML = '<option value="">Todas las escuelas</option>'; sel2.innerHTML = ''; if(sel3) sel3.innerHTML = '<option value="">Todas las escuelas</option>';
  allUniversidades.forEach(u => { sel1.insertAdjacentHTML('beforeend', `<option value="${u.id}">${u.nombre}</option>`); sel2.insertAdjacentHTML('beforeend', `<option value="${u.id}">${u.nombre}</option>`); if(sel3) sel3.insertAdjacentHTML('beforeend', `<option value="${u.id}">${u.nombre}</option>`); });
}
function abrirModalCodigos() { document.getElementById('tbody-codigos').innerHTML = allUniversidades.map(u => `<tr><td><code>${u.codigo}</code></td><td>${u.nombre}</td></tr>`).join(''); openModal('modal-codigos'); }

async function cargarAlumnos() {
  allAlumnos = (await py('listar_alumnos')).data?.alumnos || []; 
  filtrarAlumnos(); // Respetar filtros pegajosos
  document.getElementById('stat-mip1').textContent = allAlumnos.filter(a => a.grado==='MIP 1').length; document.getElementById('stat-mip2').textContent = allAlumnos.filter(a => a.grado==='MIP 2').length; document.getElementById('stat-total').textContent = allAlumnos.length; document.getElementById('stat-escuelas').textContent = allUniversidades.length;
}
function renderTablaAlumnos(lista) {
  const tbody = document.getElementById('tbody-alumnos');
  if(!lista.length) { tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">👥<h3>No hay alumnos</h3></div></td></tr>`; return; }
  tbody.innerHTML = lista.map(a => `<tr style="cursor:pointer;" onclick="abrirExpediente('${a.mip_id}')"><td><code>${a.mip_id}</code></td><td>${a.nombre_completo||`${a.ap_paterno} ${a.nombres}`}</td><td>${a.universidad_nombre||'—'}</td><td><span class="badge-${a.grado==='MIP 1'?'mip1':'mip2'}">${a.grado}</span></td><td>${a.ciclo_ingreso}</td><td><div style="display:flex;gap:4px;"><button class="btn btn-ghost btn-icon btn-sm" onclick="event.stopPropagation(); editarAlumno('${a.mip_id}')">✏️</button><button class="btn btn-ghost btn-icon btn-sm" onclick="event.stopPropagation(); eliminarAlumno('${a.mip_id}','${a.nombre_completo||a.nombres}')">🗑️</button></div></td></tr>`).join('');
}
function filtrarAlumnos() {
  const q = document.getElementById('search-alumnos').value.toLowerCase(), gr = document.getElementById('filter-grado').value, esc = document.getElementById('filter-escuela-al').value;
  renderTablaAlumnos(allAlumnos.filter(a => { const n=(a.nombre_completo||a.nombres).toLowerCase(); return (!q || n.includes(q) || a.mip_id.includes(q)) && (!gr || a.grado===gr) && (!esc || String(a.universidad_id)===esc); }));
}
async function cargarEstadisticasInicio() { await cargarAlumnos(); }

function openModalAlumno() {
  document.getElementById('modal-alumno-title').textContent = '👤 Agregar Alumno'; document.getElementById('al-edit-id-old').value = '';
  ['al-paterno','al-materno','al-nombres','al-mipid'].forEach(i => document.getElementById(i).value='');
  document.getElementById('al-grado').value = 'MIP 1'; document.getElementById('al-ciclo').value = document.getElementById('ciclo-input').value; document.getElementById('wrap-egresar').style.display='none'; openModal('modal-alumno'); 
}
function editarAlumno(id) {
  const a = allAlumnos.find(x=>x.mip_id===id); if(!a) return;
  document.getElementById('modal-alumno-title').textContent = '✏️ Editar Alumno'; document.getElementById('al-edit-id-old').value = a.mip_id;
  document.getElementById('al-paterno').value=a.ap_paterno; document.getElementById('al-materno').value=a.ap_materno; document.getElementById('al-nombres').value=a.nombres; document.getElementById('al-universidad').value=a.universidad_id; document.getElementById('al-mipid').value=a.mip_id; document.getElementById('al-grado').value=a.grado; document.getElementById('al-ciclo').value=a.ciclo_ingreso; document.getElementById('wrap-egresar').style.display='block'; openModal('modal-alumno');
}
async function guardarAlumno() {
  const data = { mip_id_old:document.getElementById('al-edit-id-old').value, mip_id:document.getElementById('al-mipid').value.trim(), mip_id_new:document.getElementById('al-mipid').value.trim(), ap_paterno:document.getElementById('al-paterno').value.trim(), ap_materno:document.getElementById('al-materno').value.trim(), nombres:document.getElementById('al-nombres').value.trim(), grado:document.getElementById('al-grado').value, ciclo:document.getElementById('al-ciclo').value.trim(), universidad_id:parseInt(document.getElementById('al-universidad').value) };
  if(!data.ap_paterno || !data.nombres) return toast('Paterno y nombre requeridos','error');
  showProgress(30); const r = await py(data.mip_id_old?'actualizar_alumno':'crear_alumno', data); showProgress(100);
  if(r.ok) { toast(`✓ Alumno ${data.mip_id_old?'actualizado':'creado'}`,`success`); closeModal('modal-alumno'); await cargarAlumnos(); document.getElementById('warning-alumnos').classList.add('hidden'); } else toast('Error: '+r.error,'error');
}
function eliminarAlumno(id, nom) { confirmDialog('Eliminar', `¿Eliminar a ${nom}?`, async ()=>{ const r=await py('eliminar_alumno',{mip_id:id}); if(r.ok){toast('Eliminado','success');await cargarAlumnos();} else toast(r.error,'error'); },'🗑️'); }
function egresarAlumnoIndividual() { const id=document.getElementById('al-edit-id-old').value; confirmDialog('Egresar', '¿Marcar como inactivo (egresado)?', async ()=>{ showProgress(30); const r=await py('egresar_alumno_individual',{mip_id:id}); showProgress(100); if(r.ok){toast('Egresado','success');closeModal('modal-alumno');await cargarAlumnos();} else toast(r.error,'error'); },'🎓'); }

async function abrirExpediente(id) {
  const a = allAlumnos.find(x=>x.mip_id===id); if(!a) return;
  document.getElementById('exp-nombre').textContent = `${a.ap_paterno} ${a.ap_materno} ${a.nombres}`; document.getElementById('exp-id').textContent = a.mip_id; document.getElementById('exp-univ').textContent = a.universidad_nombre||'Desconocida'; document.getElementById('exp-grado').textContent = a.grado; document.getElementById('exp-ciclo').textContent = a.ciclo_ingreso||'—';
  const l = MAPA_LOGOS[(a.universidad_nombre||'').toUpperCase()] || (a.universidad_codigo?a.universidad_codigo.toUpperCase():'default'); document.getElementById('exp-foto').src = `../assets/logos/${l}.png`;
  document.getElementById('btn-print-rot').onclick = ()=>imprimirHojaIndividual(a,'rotacion'); document.getElementById('btn-print-ex').onclick = ()=>imprimirHojaIndividual(a,'examen');
  openModal('modal-expediente');
}
function cerrarExpYBuscar() { closeModal('modal-expediente'); goTo('calificaciones'); }
async function imprimirHojaIndividual(a, t) {
  showProgress(30); const r = await py(`generar_hojas_${t}`, {csv_guardias:`Nombre,ID,Grado,Universidad\n${a.nombre_completo||a.nombres},${a.mip_id},${a.grado},${a.universidad_nombre}`}); showProgress(100);
  if(r.ok){toast('✓ Generada','success'); window.api.openFolder(r.data.directorio);} else toast('Error: '+r.error,'error');
}

// ── EXPORTACIÓN ALUMNOS Y LISTAS ──
async function openImportAlumnos() { const f = await window.api.openCSV('Seleccionar CSV alumnos'); if(!f) return; showProgress(40); const r = await py('importar_alumnos_csv',{contenido:f.content, ruta:f.path}); showProgress(100); if(r.ok){toast(`✓ ${r.data.ok?.length||0} alumnos importados`,'success');await cargarAlumnos(); actualizarBotonDeshacer();} else toast('Error: '+r.error,'error'); }
async function descargarEjemploAlumnos() { confirmDialog('Aviso Importante', 'Usa los NOMBRES EXACTOS (ej. UNAM, IPN) en la columna UNIVERSIDAD.', async ()=>{ const r = await py('generar_csv_ejemplo_alumnos'); if(r.ok) await window.api.saveCSV(r.data.csv, 'ejemplo_alumnos.csv'); }, '💡'); }

function openModalExportarLista() { openModal('modal-exportar-lista'); }
async function ejecutarExportarLista() {
  const tipo = document.getElementById('exp-lista-tipo').value; const grado = document.getElementById('exp-lista-grado').value;
  showProgress(30); const r = await py('exportar_lista_asistencia', { tipo, grado_filtro: grado }); showProgress(100);
  if(r.ok || r.data?.path) { toast('Excel generado.', 'success'); closeModal('modal-exportar-lista'); window.api.openFile(r.data.path); } else toast('Error al generar lista', 'error');
}
async function ejecutarExportarListaPDF() {
  const tipo = document.getElementById('exp-lista-tipo').value; const grado = document.getElementById('exp-lista-grado').value;
  showProgress(30); const r = await py('exportar_lista_asistencia_pdf', { tipo, grado_filtro: grado }); showProgress(100);
  if(r.ok || r.data?.path) { toast('PDF generado.', 'success'); closeModal('modal-exportar-lista'); window.api.openFile(r.data.path); } else toast('Error al generar PDF: ' + (r.error || ''), 'error');
}

async function cargarEgresados() {
  const c = document.getElementById('filter-ciclo-eg')?.value||''; const r = await py('listar_egresados',{ciclo_egreso:c||null});
  document.getElementById('tbody-egresados').innerHTML = (r.data?.egresados||[]).map(e=>`<tr><td><code>${e.mip_id}</code></td><td>${e.ap_paterno} ${e.nombres}</td><td>${e.universidad_nombre||'—'}</td><td>${e.ciclo_egreso}</td></tr>`).join('')||'<tr><td colspan="4" class="text-muted text-center">Sin egresados</td></tr>';
}
function renderEscuelas() {
  document.getElementById('schools-grid').innerHTML = allUniversidades.map(u => {
    const l = MAPA_LOGOS[u.nombre.toUpperCase()] || (u.codigo?u.codigo.toUpperCase():'default');
    return `<div class="school-card" onclick="verAlumnosEscuela(${u.id},'${u.nombre.replace(/'/g,"\\'")}')"><img src="../assets/logos/${l}.png" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="school-logo-placeholder" style="display:none">${u.nombre.charAt(0)}</div><strong>${u.nombre}</strong><span>${allAlumnos.filter(a=>a.universidad_id===u.id).length} alumnos</span></div>`;
  }).join('');
}
function verAlumnosEscuela(uId, nom) { document.getElementById('schools-grid-view').style.display='none'; document.getElementById('school-detail-view').style.display='block'; document.getElementById('btn-back-escuela').style.display='inline-flex'; document.getElementById('school-detail-title').textContent=`🏫 ${nom}`; document.getElementById('tbody-school-detail').innerHTML = allAlumnos.filter(a=>a.universidad_id===uId).map(a=>`<tr style="cursor:pointer;" onclick="abrirExpediente('${a.mip_id}')"><td><code>${a.mip_id}</code></td><td>${a.nombre_completo||a.nombres}</td><td><span class="badge-${a.grado==='MIP 1'?'mip1':'mip2'}">${a.grado}</span></td></tr>`).join('')||'<tr><td colspan="3" class="text-muted">Sin alumnos</td></tr>'; }
function mostrarEscuelas() { document.getElementById('schools-grid-view').style.display='block'; document.getElementById('school-detail-view').style.display='none'; document.getElementById('btn-back-escuela').style.display='none'; }

// ── HOJAS Y ROTACIONES ──
function checkGradoSelect() { const s=document.getElementById('rot-gen-grado'); if(s)s.addEventListener('change',()=>document.getElementById('rot-csv-guardia-wrap').style.display=s.value==='guardia'?'block':'none'); }
function checkExamGradoSelect() { const s=document.getElementById('exam-gen-grado'); if(s)s.addEventListener('change',()=>document.getElementById('exam-csv-guardia-wrap').style.display=s.value==='guardia'?'block':'none'); }
async function cargarCsvGuardia(t) {
  const f = await window.api.openCSV('Guardias CSV / Excel');
  if(!f) return;
  if(t==='rot') {
    rotGuardiaCsv = f.content;       // null para xlsx
    rotGuardiaPath = f.path;          // siempre disponible
    document.getElementById('rot-guardia-filename').textContent = f.name;
  } else {
    examGuardiaCsv = f.content;
    examGuardiaPath = f.path;
    document.getElementById('exam-guardia-filename').textContent = f.name;
  }
}
async function descargarEjemploGuardias() { const r = await py('generar_csv_ejemplo_guardias'); if(r.ok) await window.api.saveCSV(r.data.csv, 'ejemplo_guardias.csv'); }

async function generarHojasRotacion() {
  const g = document.getElementById('rot-gen-grado').value, d = document.getElementById('rot-out-dir').value, p = {output_dir:d||null};
  if(g==='guardia'){
    if(!rotGuardiaCsv && !rotGuardiaPath) return toast('Carga el archivo de guardia (CSV o Excel)','warning');
    if(rotGuardiaCsv) p.csv_guardias = rotGuardiaCsv;
    else p.csv_guardias_ruta = rotGuardiaPath;  // xlsx: pasar ruta a Python
  } else if(g) p.grado=g;
  showProgress(20); const r=await py('generar_hojas_rotacion',p); showProgress(100);
  if(r.ok){ const n=r.data?.generados??0; toast(n>0?`✓ ${n} hojas generadas`:'Sin hojas generadas — revisa los errores en la consola', n>0?'success':'warning', 6000); if(n>0&&r.data?.directorio) window.api.openFolder(r.data.directorio); } else toast('Error: '+r.error,'error');
}
async function importarCSVRotaciones() {
  const f = await window.api.openCSV('Seleccionar EVAL.csv (Rotaciones)'); if(!f) return;
  showProgress(30); const r = await py('importar_rotaciones',{contenido:f.content, ruta:f.path, nombre_archivo:f.name}); showProgress(100);
  if(!r.ok) return toast('Error: '+r.error,'error'); const d = document.getElementById('rot-import-result'); d.innerHTML = `<div class="card mt-2"><p>✅ Insertados: <strong>${r.data.insertados||0}</strong> | ⏭ Ignorados: ${r.data.ignorados||0}</p></div>`;
  if(r.data.duplicados_alerta?.length) { toast(`⚠️ ${r.data.duplicados_alerta.length} duplicados. Revisa el panel.`, 'warning'); cargarAlertasDuplicados(); } else toast(`✓ Importado`,'success');
  actualizarBotonDeshacer();
}
async function cargarAlertasDuplicados() {
  const r = await py('get_alertas_duplicados'), a = r.data?.alertas||[], p = document.getElementById('duplicados-panel');
  if(!a.length) return p.style.display='none'; p.style.display='block';
  document.getElementById('duplicados-list').innerHTML = a.map(d=>{ const nom=allAlumnos.find(x=>x.mip_id===d.student_id)?.nombre_completo||'Desconocido'; return `<div class="dup-card"><div class="flex-between"><div><strong>${d.student_id} — ${nom}</strong><br><em class="text-muted text-sm">Conflicto en: ${d.materia}</em></div><div class="text-warning text-sm text-right">Dif: <b>${parseFloat(d.diferencia_dias).toFixed(1)} días</b></div></div><div style="display:flex;gap:16px;margin-top:10px"><div class="text-sm text-muted">🔴 <b>${d.pts1} pts</b> <br><span style="font-size:11px">@ ${d.ts1}</span></div><div class="text-sm text-muted">🟢 <b>${d.pts2} pts</b> <br><span style="font-size:11px">@ ${d.ts2}</span></div></div><div class="mt-1 flex gap-2"><button class="btn btn-ghost btn-sm" onclick="resolverDup(${d.id},'promediar')">➗ Promedio</button><button class="btn btn-ghost btn-sm" onclick="resolverDup(${d.id},'mejor')">🏆 Mejor</button><button class="btn btn-ghost btn-sm" onclick="resolverDup(${d.id},'mas_reciente')">⏱ Reciente</button><button class="btn btn-ghost btn-sm" onclick="resolverDup(${d.id},'guardar_duplicado')">💾 Ambos</button></div></div>` }).join('');
}
async function resolverDup(id, res) { showProgress(30); const r=await py('resolver_duplicado',{alerta_id:id,resolucion:res}); showProgress(100); if(r.ok){toast('Resuelto','success');cargarAlertasDuplicados();cargarTablaGlobal();}else toast('Error','error'); }

function filtrarTablaRot(gr, ctx) { 
  rotGrado=gr; 
  if(ctx){ctx.closest('.tab-group').querySelectorAll('button').forEach(b=>b.classList.remove('active')); ctx.classList.add('active');} 
  py('get_tabla_global',{grado:rotGrado||null}).then(r=>{ 
    document.getElementById('tbody-rot-cal').innerHTML = (r.data?.tabla||[]).map(row=>`<tr><td>${row.nombre_completo||''}</td><td><code>${row.mip_id}</code></td><td><span class="badge-${row.grado==='MIP 1'?'mip1':'mip2'}">${row.grado}</span></td><td>${gradePill(row.gyo_rot)}</td><td>${gradePill(row.mi_rot)}</td><td>${gradePill(row.ciru_rot)}</td><td>${gradePill(row.pedia_rot)}</td><td>${gradePill(row.fam_rot)}</td><td>${gradePill(row.urg_rot)}</td></tr>`).join('')||'<tr><td colspan="9" class="text-center text-muted">Vacio</td></tr>'; 
  }); 
}

// ── PIZARRÓN DE EXÁMENES (PREVIEW LOTE) ──
async function generarHojasExamen() {
  const g = document.getElementById('exam-gen-grado').value, d = document.getElementById('exam-out-dir').value, p = {output_dir:d||null};
  if(g==='guardia'){
    if(!examGuardiaCsv && !examGuardiaPath) return toast('Carga el archivo de guardia (CSV o Excel)','warning');
    if(examGuardiaCsv) p.csv_guardias = examGuardiaCsv;
    else p.csv_guardias_ruta = examGuardiaPath;  // xlsx: pasar ruta a Python
  } else if(g) p.grado=g;
  showProgress(20); const r=await py('generar_hojas_examen',p); showProgress(100);
  if(r.ok){ const n=r.data?.generados??0; toast(n>0?`✓ ${n} hojas generadas`:'Sin hojas generadas — revisa los errores en la consola', n>0?'success':'warning', 5000); if(n>0&&r.data?.directorio) window.api.openFolder(r.data.directorio); } else toast('Error: '+r.error,'error');
}

async function importarCSVExamenPreview() {
  const f = await window.api.openCSV('Seleccionar CSV Examen ZipGrade'); if(!f) return;
  showProgress(30); const r = await py('importar_examenes_preview', { contenido: f.content, ruta: f.path }); showProgress(100);
  if(!r.ok) return toast('Error: ' + r.error, 'error');
  examPreviewLote = r.data.registros || [];
  document.getElementById('card-upload-exam').style.display = 'none'; document.getElementById('card-preview-exam').style.display = 'block'; document.getElementById('preview-global-extra').value = 0;
  document.getElementById('card-preview-exam').dataset.hash = "preview_" + Date.now(); document.getElementById('card-preview-exam').dataset.filename = f.name;
  document.getElementById('card-preview-exam').dataset.filepath = f.path;
  renderTablaPreviewExamenes();
}

function renderTablaPreviewExamenes() {
  document.getElementById('tbody-preview-exam').innerHTML = examPreviewLote.map((reg, idx) => {
    const tot = Math.min(100, parseFloat(reg.base) + parseFloat(reg.extra || 0));
    return `<tr><td><code>${reg.mip_id}</code></td><td>${reg.nombre}</td><td><span class="badge-${reg.grado_ref==='MIP 1'?'mip1':'mip2'}">${reg.grado_ref}</span></td><td style="font-weight:bold;">${reg.base}</td><td><input type="number" class="form-control" style="width:70px" value="${reg.extra}" onchange="actualizarExtraPreview(${idx}, this.value)" step="0.1"></td><td style="font-weight:bold; color:${tot>=70?'var(--verde)':tot>=60?'var(--warning)':'var(--danger)'}">${Math.floor(tot + 0.5)}</td></tr>`;
  }).join('');
}

function aplicarExtraGlobalPreview() { const v = parseFloat(document.getElementById('preview-global-extra').value) || 0; examPreviewLote.forEach(r => r.extra = v); renderTablaPreviewExamenes(); toast(`Ajuste de ${v} aplicado a todos.`, 'info', 1500); }
function actualizarExtraPreview(idx, val) { examPreviewLote[idx].extra = parseFloat(val) || 0; renderTablaPreviewExamenes(); }
function cancelarPreview() { examPreviewLote = []; document.getElementById('card-preview-exam').style.display = 'none'; document.getElementById('card-upload-exam').style.display = 'block'; }

async function confirmarYGuardarLote(modo = 'nuevo') {
  const mat = document.getElementById('exam-import-materia').value, tip = document.getElementById('exam-import-tipo').value, fname = document.getElementById('card-preview-exam').dataset.filename, hash = document.getElementById('card-preview-exam').dataset.hash, filepath = document.getElementById('card-preview-exam').dataset.filepath;

  // Si es la primera llamada (modo='nuevo'), verificar si ya existen registros
  if(modo === 'nuevo') {
    showProgress(15);
    const chk = await py('check_examenes_existentes', { materia: mat, tipo_examen: tip });
    showProgress(30);
    if(chk.ok && chk.data?.existentes) {
      // Ya existen registros — mostrar modal de advertencia
      abrirModalDuplicadoExamen(mat, tip, chk.data.count, chk.data.ciclo);
      return;
    }
  }

  showProgress(50);
  const r = await py('guardar_examenes_lote', { registros: examPreviewLote, materia: mat, tipo_examen: tip, nombre_archivo: fname, hash_csv: hash, ruta: filepath, modo });
  showProgress(100);
  if(r.ok) {
    const modoStr = modo==='reemplazar' ? ' (reemplazado)' : modo==='complementar' ? ' (complementado)' : '';
    toast(`✓ ${r.data.insertados} exámenes guardados${modoStr}`, 'success');
    cancelarPreview();
    cargarTablaGlobal();
    actualizarBotonDeshacer();
    actualizarIndicadorExamenesEvaluados();
    document.getElementById('exam-res-materia').value = mat;
    document.getElementById('exam-res-tipo').value = tip;
    document.getElementById('btn-exam-resultados')?.click();
  } else toast('Error: ' + r.error, 'error');
}

// ── MODAL DE DUPLICADO DE EXAMEN ──
function abrirModalDuplicadoExamen(mat, tip, count, ciclo) {
  document.getElementById('dup-exam-info').innerHTML =
    `Ya existen <strong>${count}</strong> registro(s) de <strong>${mat} — ${tip}</strong> para el ciclo <strong>${ciclo}</strong>.`;
  document.getElementById('modal-dup-exam').classList.add('open');
}

function cerrarModalDuplicadoExamen() {
  document.getElementById('modal-dup-exam').classList.remove('open');
}

function elegirModoDuplicadoExamen(modo) {
  cerrarModalDuplicadoExamen();
  if(modo === 'cancelar') { toast('Importación cancelada.', 'info', 2000); return; }
  if(modo === 'complementar') { confirmarYGuardarLote('complementar'); return; }
  if(modo === 'reemplazar') {
    confirmDialog(
      '⚠️ Reemplazar Todo',
      'Se eliminarán <strong>todos</strong> los registros anteriores de este examen y se sustituirán por los nuevos importados.<br><br>Esta acción no se puede deshacer.',
      () => confirmarYGuardarLote('reemplazar')
    );
  }
}

// ── MANUAL Y CAMPANA ──
function abrirModalManual(ctx) {
  document.getElementById('manual-contexto').value=ctx;
  document.getElementById('manual-alumno').innerHTML='<option value="">Selecciona...</option>'+allAlumnos.map(a=>`<option value="${a.mip_id}">${a.nombre_completo||a.nombres}</option>`).join('');
  document.getElementById('manual-calificacion').value='';

  // Filtrar opciones de materia según contexto
  const matSel = document.getElementById('manual-materia');
  Array.from(matSel.options).forEach(o => {
    if(ctx==='rotacion') {
      // En rotación: ocultar Urg-Fam (clona) y Troncal (solo aplican en exámenes)
      o.style.display = (o.value==='Urg-Fam' || o.value==='Troncal') ? 'none' : '';
    } else {
      o.style.display = '';  // mostrar todas en examen
    }
  });
  matSel.selectedIndex = 0;
  // Si el primer valor seleccionado es uno oculto, buscar el siguiente visible
  for(let i=0; i<matSel.options.length; i++){
    if(matSel.options[i].style.display!=='none'){ matSel.selectedIndex=i; break; }
  }

  // Filtrar tipos
  const t=document.getElementById('manual-tipo');
  Array.from(t.options).forEach(o=>{
    if(ctx==='rotacion'){
      o.style.display=o.value==='rotacion'?'':'none';
      if(o.value==='rotacion') t.value='rotacion';
    } else {
      // En examen: ocultar rotacion y troncal (troncal ya es materia, no tipo)
      o.style.display=(o.value==='rotacion'||o.value==='troncal')?'none':'';
      if(o.value==='parcial') t.value='parcial';
    }
  });
  openModal('modal-manual');
}
async function guardarRegistroManual() {
  const i=document.getElementById('manual-alumno').value, m=document.getElementById('manual-materia').value, t=document.getElementById('manual-tipo').value, c=document.getElementById('manual-calificacion').value;
  const ctx=document.getElementById('manual-contexto').value;
  if(!i||!m||!t||!c) return toast('Completa los campos','warning'); showProgress(30); const r=await py('registrar_manual',{mip_id:i,materia:m,tipo_registro:t,calificacion:c}); showProgress(100);
  if(r.ok){
    toast('✓ Guardado','success');
    closeModal('modal-manual');
    cargarTablaGlobal();
    // Si estamos en contexto de rotación, refrescar también la tabla de calificaciones de rotaciones
    if(ctx==='rotacion') filtrarTablaRot(rotGrado, null);
  } else toast('Error','error');
}
function abrirModalCampana(ctx) {
  if (ctx === 'rotacion') { toast('La campana no está disponible para Rotaciones.', 'warning'); return; }
  document.getElementById('campana-contexto').value=ctx;
  // Si hay una vista previa activa, la campana trabaja sobre ella (no sobre la BD)
  const enPreview = document.getElementById('card-preview-exam').style.display !== 'none' && examPreviewLote.length > 0;
  document.getElementById('campana-modo-info').style.display = enPreview ? 'block' : 'none';
  const t=document.getElementById('campana-tipo'); Array.from(t.options).forEach(o=>{o.style.display=o.value==='rotacion'?'none':'block';if(o.value==='parcial')t.value='parcial';}); openModal('modal-campana');
}
async function ejecutarCampana() {
  const b = parseFloat(document.getElementById('campana-base').value);
  if(!b || b <= 0) return toast('Base inválida','warning');

  const enPreview = document.getElementById('card-preview-exam').style.display !== 'none' && examPreviewLote.length > 0;

  if(enPreview) {
    // Modo preview: modificar el array JS sin tocar la BD
    const maxBase = Math.max(...examPreviewLote.map(r => parseFloat(r.base) + parseFloat(r.extra || 0)));
    if(maxBase <= 0) return toast('No hay calificaciones en la vista previa','warning');
    const factor = b / maxBase;
    examPreviewLote = examPreviewLote.map(r => {
      const totalActual = parseFloat(r.base) + parseFloat(r.extra || 0);
      const nuevoTotal = Math.min(b, totalActual * factor);
      return { ...r, base: nuevoTotal, extra: 0 };
    });
    renderTablaPreviewExamenes();
    closeModal('modal-campana');
    toast(`✓ Campana aplicada en vista previa (máx → ${b}). Guarda con "Confirmar y Guardar Todo".`, 'success', 5000);
  } else {
    // Modo directo (fuera de preview): modificar la BD con contraseña
    const mat=document.getElementById('campana-materia').value, t=document.getElementById('campana-tipo').value;
    confirmDialog('Aplicar Campana a BD',`¿Elevar ${mat} ${t} a ${b}? Esto modifica calificaciones guardadas.`, async ()=>{
      showProgress(30); const r=await py('aplicar_campana',{materia:mat,tipo_registro:t,cal_base:b}); showProgress(100);
      if(r.ok){toast('✓ Campana aplicada','success');closeModal('modal-campana');cargarTablaGlobal();} else toast(r.error,'error');
    });
  }
}

// ── RESULTADOS HISTÓRICOS (EXÁMENES) ──
function switchResultadosTab(grado, btn) {
  resGradoActual = grado;
  btn.closest('.tab-group').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
  cargarResultadosExamen();
}
async function cargarResultadosExamen() {
  const materia = document.getElementById('exam-res-materia').value; const tipo = document.getElementById('exam-res-tipo').value;
  const r = await py('get_tabla_examenes', { materia, tipo_examen: tipo, grado: resGradoActual });
  cacheResultados = r.data?.tabla || [];
  renderResultados();
}
function renderResultados() {
  let data = [...cacheResultados];
  if (resSortCol) {
    const key = resSortCol === 'mip1' ? 'mip1_score' : 'mip2_score';
    data.sort((a, b) => {
      const va = a[key] ?? -1, vb = b[key] ?? -1;
      return resSortDir === 'desc' ? vb - va : va - vb;
    });
  }
  const icons = { null: '⇅', desc: '▼', asc: '▲' };
  document.getElementById('sort-icon-mip1').textContent = resSortCol === 'mip1' ? icons[resSortDir] : '⇅';
  document.getElementById('sort-icon-mip2').textContent = resSortCol === 'mip2' ? icons[resSortDir] : '⇅';
  document.getElementById('tbody-resultados-exam').innerHTML = data.map((row, i) => `<tr>
    <td>${i+1}</td><td style="text-align:left;">${row.nombre}</td><td class="text-sm text-muted">${row.universidad||'—'}</td>
    <td>${gradePill(row.mip1_score)}</td><td>${gradePill(row.mip2_score)}</td>
  </tr>`).join('') || `<tr><td colspan="5" class="text-muted text-center">Sin datos para ${resGradoActual}</td></tr>`;
}
function sortResultados(col) {
  if (resSortCol === col) { resSortDir = resSortDir === 'desc' ? 'asc' : 'desc'; }
  else { resSortCol = col; resSortDir = 'desc'; }
  renderResultados();
}
function onMateriaCambio() {
  const mat = document.getElementById('exam-import-materia').value;
  const tipoSel = document.getElementById('exam-import-tipo');
  if (mat === 'Troncal') {
    tipoSel.value = 'parcial';
    tipoSel.disabled = true;
  } else {
    tipoSel.disabled = false;
  }
  actualizarIndicadorExamenesEvaluados();
}

async function actualizarIndicadorExamenesEvaluados() {
  const mat = document.getElementById('exam-import-materia')?.value;
  const tip = document.getElementById('exam-import-tipo')?.value;
  const indicador = document.getElementById('exam-evaluado-indicator');
  if(!indicador || !mat || !tip) return;
  // Troncal no tiene registros propios (es compuesto); ocultar indicador
  if(mat === 'Troncal') { indicador.style.display = 'none'; return; }
  // Consulta directa: sin expansión de materia (solo la materia seleccionada literalmente)
  const chk = await py('check_examenes_existentes', { materia: mat, tipo_examen: tip });
  if(chk.ok && chk.data?.existentes) {
    indicador.textContent = `✅ Ya evaluado — ${chk.data.count} registros en ciclo ${chk.data.ciclo}`;
    indicador.style.color = 'var(--verde)';
    indicador.style.display = 'block';
  } else {
    indicador.style.display = 'none';
  }
}

// Colores en lista de resultados de exámenes (indica exámenes ya evaluados)
let _examenesConDatos = {};
async function cargarExamenesConDatos() {
  const materias = ['Cirugía','Medicina Interna','Pediatría','GyO','Urgencias','Familiar'];
  const tipos = ['parcial','final','remedial'];
  _examenesConDatos = {};
  for(const mat of materias) {
    for(const tip of tipos) {
      const chk = await py('check_examenes_existentes', { materia: mat, tipo_examen: tip });
      if(chk.ok && chk.data?.existentes) {
        _examenesConDatos[`${mat}|${tip}`] = true;
      }
    }
  }
  // Colorear options en los selectores de resultados
  const resMat = document.getElementById('exam-res-materia');
  const resTip = document.getElementById('exam-res-tipo');
  if(resMat) Array.from(resMat.options).forEach(o => {
    const tieneAlgo = tipos.some(t => _examenesConDatos[`${o.value}|${t}`]);
    o.style.color = tieneAlgo ? 'var(--verde)' : '';
    o.style.fontWeight = tieneAlgo ? 'bold' : '';
  });
}

async function exportarResultadosExamen() { abrirModalExportResultados(); }
function abrirModalExportResultados() {
  document.getElementById('export-res-ciclo-opt').value = 'actual';
  openModal('modal-export-resultados');
}
async function confirmarExportResultados() {
  const mat = document.getElementById('exam-res-materia').value;
  const tip = document.getElementById('exam-res-tipo').value;
  const cicloOpt = document.getElementById('export-res-ciclo-opt').value;
  closeModal('modal-export-resultados');
  showProgress(30);
  const r = await py('exportar_resultados_examen', { materia: mat, tipo_examen: tip, export_type: 'excel', ciclo_opt: cicloOpt });
  showProgress(100);
  if (r.ok || r.data?.path) { toast(`✓ Excel generado (${cicloOpt})`, 'success'); window.api.openFile(r.data?.path || r.path); }
  else toast('Error al exportar: ' + (r.error || ''), 'error');
}

// ── CALIFICACIONES GLOBALES Y MEGA TABLA (UNIFICADA) ──
function filtrarCalGlobal(gr, ctx) { 
  calGrado=gr; 
  if(ctx){ctx.closest('.tab-group').querySelectorAll('button').forEach(b=>b.classList.remove('active')); ctx.classList.add('active');} 
  cargarTablaGlobal();
  // Si estadísticas está visible, recargar también
  if(document.getElementById('tab-cal-estadisticas')?.style.display === 'block') cargarGraficosExamen();
}

async function cargarTablaGlobal() {
  const tr = document.getElementById('check-troncal').checked; const rem = document.getElementById('check-remedial').checked;
  const [rGlobal, rMega] = await Promise.all([
     py('get_tabla_global', { grado: calGrado||null, usar_troncal: tr, usar_remedial: rem }),
     py('get_vista_global_examenes', { usar_troncal: tr, usar_remedial: rem })
  ]);
  cacheDataGlobal = rGlobal.data?.tabla || []; cacheDataMega = rMega.data?.tabla || [];
  renderTablasCalificaciones();
}

async function cargarVistaGlobalExamenes() { cargarTablaGlobal(); }

function renderTablasCalificaciones() {
   const q = document.getElementById('search-cal')?.value.toLowerCase() || ''; const escId = document.getElementById('filter-escuela-cal')?.value || '';
   
   const fGlobal = cacheDataGlobal.filter(a => { const nom = (a.nombre_completo||'').toLowerCase(); return (!q || nom.includes(q) || String(a.mip_id).includes(q)) && (!escId || String(a.universidad_id) === escId); });
   const fMega = cacheDataMega.filter(a => { 
       const nom = (a.nombre||'').toLowerCase(); 
       const textMatch = (!q || nom.includes(q) || String(a.mip_id).includes(q));
       const escMatch = (!escId || String(a.universidad_id) === escId);
       const gradoMatch = (!calGrado || a.grado === calGrado);
       return textMatch && escMatch && gradoMatch; 
   });

   const MAT = [ {lbl:'GyO',rot:'gyo_rot',pa:'gyo_parcial',fi:'gyo_final',tot:'gyo_total'}, {lbl:'MI',rot:'mi_rot',pa:'mi_parcial',fi:'mi_final',tot:'mi_total'}, {lbl:'Cirugía',rot:'ciru_rot',pa:'ciru_parcial',fi:'ciru_final',tot:'ciru_total'}, {lbl:'Pediatría',rot:'pedia_rot',pa:'pedia_parcial',fi:'pedia_final',tot:'pedia_total'}, {lbl:'Familiar',rot:'fam_rot',pa:'fam_parcial',fi:'fam_final',tot:'fam_total'}, {lbl:'Urgencias',rot:'urg_rot',pa:'urg_parcial',fi:'urg_final',tot:'urg_total'} ];
   document.getElementById('thead-cal-global').innerHTML=`<tr><th rowspan="2">Nombre</th><th rowspan="2">ID</th><th rowspan="2">Grado</th>${MAT.map(m=>`<th colspan="4" style="text-align:center;background:${cMap[m.lbl]}; color:var(--c-text-th)">${m.lbl}</th>`).join('')}<th rowspan="2" style="background:var(--azul-light); text-align:center;">Entregas<br>(15%)</th><th rowspan="2" style="background:var(--dorado);color:#222; text-align:center;">Final</th><th rowspan="2" style="min-width:52px;"></th></tr><tr>${MAT.map(()=>'<th>Rot</th><th>Parcial</th><th>Final</th><th>Total</th>').join('')}</tr>`;
   const OPTS = `<option value="">—</option><option value="excelente">😊 Ex (100)</option><option value="bien">🙂 Bn (85)</option><option value="decente">😐 Dec (70)</option><option value="deficiente">😕 Def (50)</option><option value="no_participa">❌ NP (0)</option>`;
   document.getElementById('tbody-cal-global').innerHTML = fGlobal.map(row=>`<tr><td style="text-align:left;">${row.nombre_completo||''}</td><td><code>${row.mip_id}</code></td><td><span class="badge-${row.grado==='MIP 1'?'mip1':'mip2'}">${row.grado}</span></td>${MAT.map(m=>`<td>${gradePill(row[m.rot])}</td><td>${gradePill(row[m.pa])}</td><td>${gradePill(row[m.fi])}</td><td style="font-weight:bold">${gradePill(row[m.tot])}</td>`).join('')}<td><select class="select-rubrica" onchange="setRubricaGlobal('${row.mip_id}',this.value)">${OPTS.replace(`value="${row.rubrica_entregas_global||''}"`, `value="${row.rubrica_entregas_global||''}" selected`)}</select></td><td style="font-weight:bold; font-size:14px;">${gradePill(row.cal_final_global)}</td><td><button class="btn btn-ghost btn-icon btn-sm" title="Editar calificaciones" onclick="abrirModalEditarCal('${row.mip_id}')">✏️</button></td></tr>`).join('')||'<tr><td colspan="31" class="text-muted text-center">Vacio</td></tr>';

   const mList = ['GyO', 'Pediatría', 'Cirugía', 'Medicina Interna', 'Urgencias', 'Familiar'];
   const tStr = document.getElementById('check-troncal').checked ? '+Tr' : '';
   const rStr = document.getElementById('check-remedial').checked ? '+Rem' : '';
   const maxTag = `<br><span style="font-size:10px; font-weight:normal; opacity:0.8; color:var(--text);">${tStr} ${rStr}</span>`;

   document.getElementById('thead-mega-examenes').innerHTML = `
     <tr><th rowspan="3" style="min-width:200px;">Nombre</th><th rowspan="3">Escuela</th><th rowspan="3">MIP ID</th>${mList.map(x=>`<th colspan="6" style="background:${cMap[x]}; color:var(--c-text-th); font-size:14px; letter-spacing:1px;">${x}</th>`).join('')}</tr>
     <tr>${mList.map(x=>`<th colspan="3" style="background:${cMap[x]}; color:var(--c-text-th); opacity:0.9;">PARCIAL</th><th colspan="3" style="background:${cMap[x]}; color:var(--c-text-th); opacity:0.8;">FINAL</th>`).join('')}</tr>
     <tr>${mList.map(()=>`<th style="background:var(--surface2); color:var(--text);">MIP 1</th><th style="background:var(--surface2); color:var(--text);">MIP 2</th><th style="background:var(--azul); color:#fff">MAX${maxTag}</th><th style="background:var(--surface2); color:var(--text);">MIP 1</th><th style="background:var(--surface2); color:var(--text);">MIP 2</th><th style="background:var(--azul); color:#fff">MAX${maxTag}</th>`).join('')}</tr>`;
     
   document.getElementById('tbody-mega-examenes').innerHTML = fMega.map(a => `
     <tr>
       <td style="text-align:left;">${a.nombre}</td><td class="text-sm">${a.escuela||'—'}</td><td><code>${a.mip_id}</code></td>
       ${mList.map(mat => `<td>${gradePill(a.materias[mat].m1_p)}</td><td>${gradePill(a.materias[mat].m2_p)}</td><td style="font-weight:bold; background:rgba(44, 79, 124, 0.1);">${gradePill(a.materias[mat].max_p)}</td><td>${gradePill(a.materias[mat].m1_f)}</td><td>${gradePill(a.materias[mat].m2_f)}</td><td style="font-weight:bold; background:rgba(44, 79, 124, 0.1);">${gradePill(a.materias[mat].max_f)}</td>`).join('')}
     </tr>`).join('') || '<tr><td colspan="40" class="text-muted text-center">Vacio</td></tr>';
}

async function exportarVistaGlobalCsv() {
  const mList = ['GyO', 'Pediatría', 'Cirugía', 'Medicina Interna', 'Urgencias', 'Familiar'];
  let csv = "Nombre,Escuela,ID," + mList.map(x=>`${x}_P_M1,${x}_P_M2,${x}_P_MAX,${x}_F_M1,${x}_F_M2,${x}_F_MAX`).join(',') + "\n";
  cacheDataMega.forEach(a => { csv += `"${a.nombre}","${a.escuela||''}",${a.mip_id},` + mList.map(mat=>`${a.materias[mat].m1_p||''},${a.materias[mat].m2_p||''},${a.materias[mat].max_p||''},${a.materias[mat].m1_f||''},${a.materias[mat].m2_f||''},${a.materias[mat].max_f||''}`).join(',') + "\n"; });
  const p = await window.api.saveCSV(csv, 'Mega_Tabla_Examenes.csv'); if(p) toast('CSV Guardado', 'success');
}

async function setRubricaGlobal(id, rub) { if(!rub)return; await py('set_rubrica_entregas_global', {mip_id:id, rubrica:rub}); cargarTablaGlobal(); }
async function recalcularTodo() { showProgress(20); const r=await py('recalcular_todo'); showProgress(100); if(r.ok){toast('✓ Recalculado','success');cargarTablaGlobal();} else toast('Error','error'); }
async function exportarExcel(t) {
  const tr = document.getElementById('check-troncal').checked;
  const rem = document.getElementById('check-remedial').checked;
  showProgress(30);
  const r = await py('exportar_excel', {tipo:t, grado:calGrado||null, usar_troncal:tr, usar_remedial:rem});
  showProgress(100);
  if(r.ok){ toast('✓ Guardado','success'); window.api.openFile(r.data.path); } else toast('Error','error');
}

// ── MODALES DE EXPORTACIÓN CON SELECCIÓN DE GRADO ──
function abrirModalExportRotaciones() { openModal('modal-export-rotaciones'); }
async function confirmarExportRotaciones() {
  const grado = document.getElementById('export-rot-grado').value;
  closeModal('modal-export-rotaciones');
  showProgress(30);
  const r = await py('exportar_excel_rotaciones', { grado: grado || null });
  showProgress(100);
  if(r.ok || r.data?.path) { toast('✓ Excel de rotaciones generado', 'success'); window.api.openFile(r.data?.path || r.path); }
  else toast('Error: ' + (r.error || ''), 'error');
}

function abrirModalExportGlobal() { openModal('modal-export-global'); }
async function confirmarExportGlobal() {
  const grado = document.getElementById('export-global-grado').value;
  const tr = document.getElementById('check-troncal').checked;
  const rem = document.getElementById('check-remedial').checked;
  closeModal('modal-export-global');
  showProgress(30);
  const r = await py('exportar_excel', { grado: grado || null, usar_troncal: tr, usar_remedial: rem });
  showProgress(100);
  if(r.ok || r.data?.path) { toast('✓ Excel global generado', 'success'); window.api.openFile(r.data?.path || r.path); }
  else toast('Error: ' + (r.error || ''), 'error');
}

function abrirModalExportMega() { openModal('modal-export-mega'); }
async function confirmarExportMega() {
  const grado = document.getElementById('export-mega-grado').value;
  const tr = document.getElementById('check-troncal').checked;
  const rem = document.getElementById('check-remedial').checked;
  closeModal('modal-export-mega');
  showProgress(30);
  const r = await py('exportar_excel_mega_examenes', { grado: grado || null, usar_troncal: tr, usar_remedial: rem });
  showProgress(100);
  if(r.ok || r.data?.path) { toast('✓ Excel mega-tabla generado', 'success'); window.api.openFile(r.data?.path || r.path); }
  else toast('Error: ' + (r.error || ''), 'error');
}

// ── EDICIÓN DE CALIFICACIONES INDIVIDUALES ──
let _editarCalRegistros = [];   // todos los registros crudos del alumno
let editarCalMipId = '';

async function abrirModalEditarCal(mip_id) {
  editarCalMipId = mip_id;
  const alumno = allAlumnos.find(a => a.mip_id === mip_id);
  document.getElementById('editar-cal-nombre').textContent = alumno?.nombre_completo || mip_id;
  document.getElementById('editar-cal-pwd').value = '';
  document.getElementById('editar-cal-valor').value = '';
  document.getElementById('editar-cal-actual').textContent = '…';
  document.getElementById('editar-cal-registro-info').textContent = '';

  showProgress(30);
  const r = await py('get_calificaciones_alumno', { mip_id });
  showProgress(100);
  if (!r.ok) return toast('Error al cargar calificaciones', 'error');

  _editarCalRegistros = [
    ...(r.data?.examenes   || []).map(e => ({...e, tabla:'examen'})),
    ...(r.data?.rotaciones || []).map(e => ({...e, tabla:'rotacion'})),
  ];

  // Seleccionar primera materia/tipo por defecto y mostrar valor actual
  document.getElementById('editar-cal-materia').value = 'GyO';
  document.getElementById('editar-cal-tipo').value = 'parcial';
  onEditarCalChange();
  openModal('modal-editar-cal');
}

function onEditarCalChange() {
  const materia = document.getElementById('editar-cal-materia').value;
  const tipo    = document.getElementById('editar-cal-tipo').value;

  // Buscar registro que coincida con materia y tipo
  let reg = null;
  if (tipo === 'rotacion') {
    reg = _editarCalRegistros.find(r => r.tabla === 'rotacion' && r.materia === materia);
  } else {
    reg = _editarCalRegistros.find(r => r.tabla === 'examen' && r.materia === materia && r.tipo_examen === tipo);
  }

  const elActual = document.getElementById('editar-cal-actual');
  const elInfo   = document.getElementById('editar-cal-registro-info');

  if (reg && reg.valor !== null && reg.valor !== undefined) {
    const val = parseFloat(reg.valor);
    elActual.textContent = Math.round(val * 10) / 10;
    elActual.style.color = val >= 70 ? 'var(--verde)' : val >= 60 ? 'var(--dorado)' : 'var(--danger)';
    elInfo.textContent = `ID registro: ${reg.id} · Ciclo: ${reg.ciclo}`;
    document.getElementById('editar-cal-valor').value = Math.round(val * 10) / 10;
  } else {
    elActual.textContent = 'Sin registro';
    elActual.style.color = 'var(--text-muted)';
    elInfo.textContent = 'No hay datos para esta materia/tipo en el ciclo actual.';
    document.getElementById('editar-cal-valor').value = '';
  }
}

async function guardarEdicionCal() {
  const pwd = document.getElementById('editar-cal-pwd').value;
  if (!pwd) return toast('Ingresa la contraseña para confirmar', 'warning');

  const auth = await py('auth_login', { pwd });
  if (!auth.data?.valid) {
    document.getElementById('editar-cal-pwd-feedback').textContent = '❌ Contraseña incorrecta';
    document.getElementById('editar-cal-pwd-feedback').className = 'pwd-feedback invalid';
    return toast('Contraseña incorrecta', 'error');
  }

  const materia   = document.getElementById('editar-cal-materia').value;
  const tipo      = document.getElementById('editar-cal-tipo').value;
  const nuevoVal  = document.getElementById('editar-cal-valor').value.trim();

  // Buscar registro existente
  let reg = null;
  if (tipo === 'rotacion') {
    reg = _editarCalRegistros.find(r => r.tabla === 'rotacion' && r.materia === materia);
  } else {
    reg = _editarCalRegistros.find(r => r.tabla === 'examen' && r.materia === materia && r.tipo_examen === tipo);
  }

  const valorNum = nuevoVal === '' ? null : parseFloat(nuevoVal);

  // Sin registro existente y valor vacío/0 → nada que hacer
  if (!reg && (valorNum === null || valorNum === 0)) {
    return toast('No hay registro que modificar para esta combinación', 'info');
  }

  // Con registro existente, valor 0 o vacío → preguntar si eliminar
  if (reg && (valorNum === null || valorNum === 0)) {
    confirmDialog('Eliminar Registro',
      `¿Eliminar la calificación de ${materia} (${tipo})? Se recalculará el promedio.`,
      async () => {
        showProgress(30);
        const r = await py('editar_calificacion', {
          registro_id: reg.id,
          tabla: reg.tabla === 'rotacion' ? 'rotacion' : 'examen',
          valor: 0
        });
        showProgress(100);
        if (r.ok) {
          toast('Registro eliminado (calificación = 0)', 'success');
          closeModal('modal-editar-cal');
          cargarTablaGlobal();
        } else toast('Error: ' + (r.error || ''), 'error');
      }, '🗑️');
    return;
  }

  if (valorNum < 0 || valorNum > 100) return toast('El valor debe estar entre 0 y 100', 'warning');

  confirmDialog('Guardar Cambio',
    `¿Cambiar ${materia} (${tipo}) a ${valorNum}?`,
    async () => {
      showProgress(20);
      let r;
      if (reg) {
        // Actualizar registro existente
        r = await py('editar_calificacion', {
          registro_id: reg.id,
          tabla: reg.tabla === 'rotacion' ? 'rotacion' : 'examen',
          valor: valorNum
        });
      } else {
        // Crear nuevo registro
        r = await py('crear_calificacion_manual', {
          mip_id: editarCalMipId,
          materia,
          tipo_examen: tipo,
          valor: valorNum
        });
      }
      showProgress(100);
      if (r.ok) {
        toast(`✓ Calificación actualizada`, 'success');
        closeModal('modal-editar-cal');
        cargarTablaGlobal();
      } else toast('Error: ' + (r.error || ''), 'error');
    }, '✏️');
}


// Feedback de contraseña en tiempo real (debounce 600ms)
let _pwdTimer = null;
async function validarPwdEdicion() {
  const fb = document.getElementById('editar-cal-pwd-feedback');
  const val = document.getElementById('editar-cal-pwd').value;
  clearTimeout(_pwdTimer);
  if (!val) { fb.textContent = ''; fb.className = 'pwd-feedback'; return; }
  fb.textContent = '⏳ Verificando…'; fb.className = 'pwd-feedback checking';
  _pwdTimer = setTimeout(async () => {
    const r = await py('auth_login', { pwd: val });
    if (r.data?.valid) { fb.textContent = '✅ Contraseña correcta'; fb.className = 'pwd-feedback valid'; }
    else { fb.textContent = '❌ Contraseña incorrecta'; fb.className = 'pwd-feedback invalid'; }
  }, 600);
}

async function cargarGraficosExamen() {
  const mat = document.getElementById('cal-exam-materia').value;
  const tip = document.getElementById('cal-exam-tipo').value;
  // Filtrar por grado activo (calGrado)
  const gradoFiltro = calGrado || null;

  // Cargar datos de gráficos
  const r = await py('get_tabla_examenes', { materia: mat || 'Cirugía', tipo_examen: tip, grado: gradoFiltro });
  const tb = r.data?.tabla || [];
  if(chartUniv) chartUniv.destroy(); if(chartDist) chartDist.destroy();

  const uM = {};
  tb.forEach(r=>{
    const u=r.universidad||'OTROS';
    if(!uM[u])uM[u]=[];
    if(r.mip1_score!==null)uM[u].push(parseFloat(r.mip1_score));
    if(r.mip2_score!==null)uM[u].push(parseFloat(r.mip2_score));
  });
  const l1=Object.keys(uM), d1=l1.map(u=>uM[u].reduce((a,b)=>a+b,0)/uM[u].length||0);
  chartUniv = new Chart(document.getElementById('chart-por-universidad').getContext('2d'), {
    type:'bar',
    data:{labels:l1,datasets:[{label:'Promedio',data:d1,backgroundColor:'#2C4F7C',borderRadius:6}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{title:{display:true,text:`${mat||'General'} ${tip}`,color:getComputedStyle(document.documentElement).getPropertyValue('--text')}},scales:{y:{min:0,max:100}}}
  });

  const b={'0-49':0,'50-59':0,'60-69':0,'70-79':0,'80-89':0,'90-100':0};
  tb.forEach(r=>{ [r.mip1_score, r.mip2_score].forEach(v=>{
    const val=parseFloat(v); if(isNaN(val))return;
    if(val<50)b['0-49']++;else if(val<60)b['50-59']++;else if(val<70)b['60-69']++;else if(val<80)b['70-79']++;else if(val<90)b['80-89']++;else b['90-100']++;
  }) });
  chartDist = new Chart(document.getElementById('chart-distribucion').getContext('2d'), {
    type:'doughnut',
    data:{labels:Object.keys(b),datasets:[{data:Object.values(b),backgroundColor:['#e74c3c','#e67e22','#f1c40f','#27ae60','#2C4F7C','#4A7C59']}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}}
  });

  // TOP — filtrado por materia (si hay selección) y por grado
  const top = await py('get_top_3_examenes', {
    materia: mat || null,
    tipo_examen: mat ? tip : null,
    grado: gradoFiltro
  });
  const topTitle = mat ? `${mat} — ${tip}` : 'General (todos los exámenes)';
  document.getElementById('top-mip2-list').innerHTML = (top.data?.mip2||[]).map((x,i)=>`<div style="display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid var(--border); padding-bottom:4px;"><span>${i===0?'🥇':i===1?'🥈':'🥉'} <b>${x.nombre}</b> <br><small class="text-muted">${x.escuela}</small></span><span style="font-weight:bold; color:var(--verde)">${Math.floor(parseFloat(x.prom) + 0.5)}</span></div>`).join('')||'<span class="text-muted">No hay datos</span>';
  document.getElementById('top-mip1-list').innerHTML = (top.data?.mip1||[]).map((x,i)=>`<div style="display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid var(--border); padding-bottom:4px;"><span>${i===0?'🥇':i===1?'🥈':'🥉'} <b>${x.nombre}</b> <br><small class="text-muted">${x.escuela}</small></span><span style="font-weight:bold; color:var(--verde)">${Math.floor(parseFloat(x.prom) + 0.5)}</span></div>`).join('')||'<span class="text-muted">No hay datos</span>';
  // Actualizar título del TOP según la materia
  const topH = document.querySelector('#tab-cal-estadisticas h3');
  if (topH) topH.textContent = `🏆 TOP 3 — ${topTitle}${gradoFiltro ? ' · ' + gradoFiltro : ''}`;
}

// ── HERENCIA DEL SISTEMA (DB) ──
function aplicarTema(t) { document.documentElement.setAttribute('data-theme', t); document.getElementById('btn-tema-oscuro')?.classList.toggle('btn-primary', t==='oscuro'); document.getElementById('btn-tema-claro')?.classList.toggle('btn-primary', t==='claro'); }
async function setTema(t) { aplicarTema(t); await py('set_config', { clave:'tema', valor:t }); }
async function guardarCiclo() { const c = document.getElementById('ciclo-input').value.trim(); if(!c)return toast('Inválido','warning'); await py('set_config', { clave:'ciclo_actual', valor:c }); document.getElementById('sidebar-cycle').textContent = `Ciclo: ${c}`; document.getElementById('ciclo-hero').textContent = c; toast('✓ Ciclo actualizado','success'); }
async function terminarCurso() { const c=document.getElementById('nuevo-ciclo-input').value.trim(); if(!c)return toast('Inválido','warning'); confirmDialog('Terminar Curso',`MIP 2 → Egresados. Nuevo: ${c}`, ()=>{ confirmDialog('Confirmar','Irreversible. ¿Proceder?', async ()=>{ showProgress(20); const r=await py('promover_curso',{ciclo_nuevo:c}); showProgress(100); if(r.ok){toast(`✓ ${r.data.egresados} egresados`,'success',8000);document.getElementById('sidebar-cycle').textContent=`Ciclo: ${c}`;document.getElementById('ciclo-hero').textContent=c;document.getElementById('warning-alumnos').classList.remove('hidden');await cargarAlumnos();}else toast('Error: '+r.error,'error'); },'⚠️'); },'🎓'); }

async function exportarBaseDatos() { showProgress(30); const r = await py('exportar_bd'); showProgress(100); if(r.ok || r.path) { toast('✓ Respaldo guardado', 'success', 5000); window.api.openFile(r.data?.path || r.path); } else toast('Error: ' + r.error, 'error'); }
async function importarBaseDatos() { confirmDialog('Importar Respaldo', 'Asegúrate de poner el archivo "Respaldo_HE_Academico.db" en tu Escritorio. Esto sobrescribirá el sistema actual.', async () => { showProgress(30); const r = await py('importar_bd'); showProgress(100); if(r.ok) { toast('✓ Respaldo importado. El sistema se reiniciará.', 'success', 5000); setTimeout(() => window.location.reload(), 2000); } else toast('Error: ' + r.error, 'error'); }, '📥'); }
async function wipeDatabase() { confirmDialog('BORRADO NUCLEAR', '¿ESTÁS 100% SEGURO? Se borrarán todos los alumnos, calificaciones, hojas y rotaciones. Úsalo solo para heredar el sistema al siguiente pasante.', () => { confirmDialog('VERIFICACIÓN FINAL', 'ÚLTIMA ADVERTENCIA. Esta acción es IRREVERSIBLE.', async () => { showProgress(30); const r = await py('borrar_todo_sistema'); showProgress(100); if(r.ok) { toast('Sistema restablecido de fábrica', 'success', 5000); setTimeout(() => window.location.reload(), 2000); } else toast('Error: ' + r.error, 'error'); }, '☢️'); }, '🗑️'); }
async function cargarHistorial() { const r = await py('get_historial_importaciones'); document.getElementById('tbody-historial').innerHTML = (r.data?.historial || []).map(h=>`<tr><td><span class="badge-mip1">${h.tipo}</span></td><td class="text-sm">${h.archivo_nombre}</td><td class="text-sm">✅${h.registros_ok||0} / ⏭${h.registros_skip||0}</td><td class="text-sm">${h.fecha?.substring(0,16)||''}</td></tr>`).join('')||'<tr><td colspan="4" class="text-muted">Sin importaciones</td></tr>'; }

// ── IMPORTAR FORMATO ANTIGUO ──
let importarAntiguoTipo = 'examenes';

function abrirImportarAntiguo(tipo) {
  importarAntiguoTipo = tipo;
  document.getElementById('importar-antiguo-tipo-lbl').textContent = tipo === 'examenes' ? 'Exámenes' : 'Rotaciones';
  document.getElementById('importar-antiguo-pwd').value = '';
  document.getElementById('importar-antiguo-ciclo').value = document.getElementById('ciclo-input')?.value || '';
  const res = document.getElementById('importar-antiguo-result');
  res.style.display = 'none'; res.innerHTML = '';
  openModal('modal-importar-antiguo');
}

async function ejecutarImportarAntiguo() {
  const pwd = document.getElementById('importar-antiguo-pwd').value;
  if (!pwd) return toast('Ingresa la contraseña para continuar', 'warning');
  const auth = await py('auth_login', { pwd });
  if (!auth.data?.valid) return toast('Contraseña incorrecta', 'error');

  const cicloDestino = document.getElementById('importar-antiguo-ciclo').value.trim();
  if (!cicloDestino) return toast('Ingresa el ciclo destino (ej. 2025-2)', 'warning');

  const f = await window.api.openXLSX(`Seleccionar archivo Excel de ${importarAntiguoTipo}`);
  if (!f) return;

  const action = importarAntiguoTipo === 'examenes'
    ? 'importar_formato_antiguo_examenes'
    : 'importar_formato_antiguo_rotaciones';

  showProgress(20);
  const r = await py(action, { content_b64: f.content_b64, ciclo_destino: cicloDestino });
  showProgress(100);

  const resDiv = document.getElementById('importar-antiguo-result');
  resDiv.style.display = 'block';
  if (r.ok) {
    const noEnc = r.data?.no_encontrados?.length ? `<br><span class="text-warning">⚠️ ${r.data.no_encontrados.length} IDs no encontrados en el sistema.</span>` : '';
    resDiv.innerHTML = `<div class="card mt-2" style="padding:12px;"><p style="color:var(--verde);"><strong>✅ Importación completada</strong></p><p class="text-sm">Registros insertados: <strong>${r.data?.insertados || 0}</strong> | Omitidos: ${r.data?.omitidos || 0}${noEnc}</p><p class="text-sm text-muted">Ciclo: ${r.data?.ciclo}</p></div>`;
    toast(`✓ ${r.data?.insertados || 0} registros importados`, 'success');
    cargarTablaGlobal();
  } else {
    resDiv.innerHTML = `<div class="card" style="padding:12px; border-color:var(--danger);"><p style="color:var(--danger);"><strong>❌ Error</strong></p><p class="text-sm">${r.error || 'Error desconocido'}</p></div>`;
    toast('Error en importación: ' + (r.error || ''), 'error');
  }
}

async function actualizarBotonDeshacer() {
  const btn = document.getElementById('btn-undo-import');
  if (!btn) return;
  const r = await py('get_ultima_importacion');
  if (r.ok && r.data?.ultima) {
    const u = r.data.ultima;
    let tipoStr = 'Importación';
    if (u.tipo === 'rotaciones') tipoStr = 'Rotaciones';
    else if (u.tipo === 'examenes') tipoStr = 'Exámenes';
    else if (u.tipo === 'alumnos_csv' || u.tipo === 'alumnos') tipoStr = 'Alumnos';
    
    btn.textContent = `↩ Deshacer: ${tipoStr}`;
    btn.title = u.archivo_nombre;  // nombre completo en tooltip
    btn.style.display = 'inline-flex';
    btn.dataset.id = u.id;
    btn.dataset.tipo = u.tipo;
    btn.dataset.filename = u.archivo_nombre;
  } else {
    btn.style.display = 'none';
  }
}

function confirmarDeshacerImportacion() {
  const btn = document.getElementById('btn-undo-import');
  if (!btn) return;
  const id = btn.dataset.id;
  const tipo = btn.dataset.tipo;
  const filename = btn.dataset.filename;
  if (!id) return;

  let details = "";
  if (tipo === 'rotaciones') {
    details = "Se eliminarán todas las calificaciones de rotaciones asociadas a este archivo y se restaurarán los estados previos.";
  } else if (tipo === 'examenes') {
    details = "Se eliminarán todos los exámenes asociados a este lote de importación.";
  } else {
    details = "Se eliminarán los alumnos creados durante esta importación (siempre y cuando no tengan calificaciones registradas).";
  }

  confirmDialog(
    '¿Deshacer Última Importación?',
    `¿Estás seguro de que deseas deshacer la importación del archivo <strong>"${filename}"</strong>?<br><br><span style="color:var(--danger)">${details}</span>`,
    async () => {
      showProgress(30);
      const r = await py('deshacer_ultima_importacion');
      showProgress(100);
      if (r.ok) {
        toast('✓ Importación deshecha correctamente', 'success');
        actualizarBotonDeshacer();
        
        // Refresh whichever section is currently active
        const activeSection = document.querySelector('.section.active')?.id;
        if (activeSection === 'sec-alumnos') {
          await cargarAlumnos();
        } else if (activeSection === 'sec-rotaciones') {
          filtrarTablaRot(rotGrado, document.querySelector('#sec-rotaciones .tab-group button.active'));
          cargarAlertasDuplicados();
        } else if (activeSection === 'sec-examenes') {
          // If we have filters/load function for exams, call it
          if (typeof cargarTablaExamenes === 'function') cargarTablaExamenes();
        } else if (activeSection === 'sec-calificaciones') {
          cargarTablaGlobal();
        }
        
        // Always refresh main global calculations/tables just in case
        cargarTablaGlobal();
      } else {
        toast('Error al deshacer: ' + (r.error || 'Intenta de nuevo'), 'error');
      }
    },
    '↩'
  );
}