/* renderer.js — Versión 1.0.0 (Completa y Depurada) */
'use strict';

let allAlumnos = [], allUniversidades = [], rotGuardiaCsv = null, examGuardiaCsv = null, chartUniv = null, chartDist = null;
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
const MAPA_LOGOS = { 'ANÁHUAC NORTE': 'ANAH', 'ANÁHUAC SUR': 'ANAH', 'IPN': 'IPN', 'ESM/IPN': 'IPN', 'LA SALLE CDMX': 'LSALLE', 'LA SALLE VICTORIA': 'LSALLE', 'MONTRER': 'MONT', 'SAINT LUKE': 'STLK', 'UAEH': 'UAEH', 'UNAM': 'UNAM', 'UNSA': 'UNSA', 'WESTHILL': 'WEST', 'TOMINAGA NAKAMOTO': 'TOMI', 'EXTRANJEROS': 'EXTRANJEROS', 'INTERCAMBIO': 'INTERCAMBIO', 'UNAM FES ZARAGOZA': 'UNAM', 'BUAP': 'OTROS' };

document.addEventListener('DOMContentLoaded', async () => {
  if (navigator.platform.includes('Mac')) document.body.classList.add('platform-darwin');
  await initDB(); await checkAuth(); 
});

async function py(action, payload = {}) { try { return await window.api.py(action, payload); } catch (e) { return { ok: false, error: e.message }; } }
async function initDB() { await py('init_db'); }

// ── SEGURIDAD (CONTRASEÑA) ──
async function checkAuth() {
  const r = await py('auth_check');
  if (r.data?.has_password) { document.getElementById('auth-login').style.display = 'block'; } 
  else { document.getElementById('auth-setup').style.display = 'block'; }
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

async function arrancarSistema() { await cargarConfig(); setupNav(); await cargarUniversidades(); await cargarAlumnos(); checkGradoSelect(); checkExamGradoSelect(); }

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
  if (section === 'calificaciones') cargarTablaGlobal(); if (section === 'escuelas') renderEscuelas(); if (section === 'rotaciones') cargarAlertasDuplicados();
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
function confirmDialog(title, msg, onOk, icon='⚠️') { document.getElementById('confirm-icon').textContent=icon; document.getElementById('confirm-title').textContent=title; document.getElementById('confirm-msg').textContent=msg; document.getElementById('confirm-overlay').classList.add('open'); document.getElementById('confirm-ok').onclick=()=>{closeModal('confirm-overlay'); onOk();}; }
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
async function openImportAlumnos() { const f = await window.api.openCSV('Seleccionar CSV alumnos'); if(!f) return; showProgress(40); const r = await py('importar_alumnos_csv',{contenido:f.content}); showProgress(100); if(r.ok){toast(`✓ ${r.data.ok?.length||0} alumnos importados`,'success');await cargarAlumnos();} else toast('Error: '+r.error,'error'); }
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
async function cargarCsvGuardia(t) { const f = await window.api.openCSV('Guardias CSV'); if(!f) return; if(t==='rot') {rotGuardiaCsv=f.content;document.getElementById('rot-guardia-filename').textContent=f.name;} else {examGuardiaCsv=f.content;document.getElementById('exam-guardia-filename').textContent=f.name;} }
async function descargarEjemploGuardias() { const r = await py('generar_csv_ejemplo_guardias'); if(r.ok) await window.api.saveCSV(r.data.csv, 'ejemplo_guardias.csv'); }

async function generarHojasRotacion() {
  const g = document.getElementById('rot-gen-grado').value, d = document.getElementById('rot-out-dir').value, p = {output_dir:d||null};
  if(g==='guardia'){if(!rotGuardiaCsv)return toast('Carga el CSV de guardia','warning');p.csv_guardias=rotGuardiaCsv;} else if(g) p.grado=g;
  showProgress(20); const r=await py('generar_hojas_rotacion',p); showProgress(100); if(r.ok)toast('Hojas generadas','success', 6000); else toast('Error: '+r.error,'error');
}
async function importarCSVRotaciones() {
  const f = await window.api.openCSV('Seleccionar EVAL.csv (Rotaciones)'); if(!f) return;
  showProgress(30); const r = await py('importar_rotaciones',{contenido:f.content, nombre_archivo:f.name}); showProgress(100);
  if(!r.ok) return toast('Error: '+r.error,'error'); const d = document.getElementById('rot-import-result'); d.innerHTML = `<div class="card mt-2"><p>✅ Insertados: <strong>${r.data.insertados||0}</strong> | ⏭ Ignorados: ${r.data.ignorados||0}</p></div>`;
  if(r.data.duplicados_alerta?.length) { toast(`⚠️ ${r.data.duplicados_alerta.length} duplicados. Revisa el panel.`, 'warning'); cargarAlertasDuplicados(); } else toast(`✓ Importado`,'success');
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
  if(g==='guardia'){if(!examGuardiaCsv)return toast('Carga CSV guardia','warning');p.csv_guardias=examGuardiaCsv;} else if(g) p.grado=g;
  showProgress(20); const r=await py('generar_hojas_examen',p); showProgress(100); if(r.ok)toast('Generadas','success'); else toast('Error','error');
}

async function importarCSVExamenPreview() {
  const f = await window.api.openCSV('Seleccionar CSV Examen ZipGrade'); if(!f) return;
  showProgress(30); const r = await py('importar_examenes_preview', { contenido: f.content }); showProgress(100);
  if(!r.ok) return toast('Error: ' + r.error, 'error');
  examPreviewLote = r.data.registros || [];
  document.getElementById('card-upload-exam').style.display = 'none'; document.getElementById('card-preview-exam').style.display = 'block'; document.getElementById('preview-global-extra').value = 0;
  document.getElementById('card-preview-exam').dataset.hash = "preview_" + Date.now(); document.getElementById('card-preview-exam').dataset.filename = f.name;
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

async function confirmarYGuardarLote() {
  const mat = document.getElementById('exam-import-materia').value, tip = document.getElementById('exam-import-tipo').value, fname = document.getElementById('card-preview-exam').dataset.filename, hash = document.getElementById('card-preview-exam').dataset.hash;
  showProgress(30); const r = await py('guardar_examenes_lote', { registros: examPreviewLote, materia: mat, tipo_examen: tip, nombre_archivo: fname, hash_csv: hash }); showProgress(100);
  if(r.ok) { toast(`✓ ${r.data.insertados} exámenes guardados`, 'success'); cancelarPreview(); cargarTablaGlobal(); } else toast('Error: ' + r.error, 'error');
}

// ── MANUAL Y CAMPANA ──
function abrirModalManual(ctx) {
  document.getElementById('manual-contexto').value=ctx; document.getElementById('manual-alumno').innerHTML='<option value="">Selecciona...</option>'+allAlumnos.map(a=>`<option value="${a.mip_id}">${a.nombre_completo||a.nombres}</option>`).join(''); document.getElementById('manual-calificacion').value=''; document.getElementById('manual-materia').selectedIndex=0;
  const t=document.getElementById('manual-tipo'); Array.from(t.options).forEach(o=>{if(ctx==='rotacion'){o.style.display=o.value==='rotacion'?'block':'none';if(o.value==='rotacion')t.value='rotacion';}else{o.style.display=o.value==='rotacion'?'none':'block';if(o.value==='parcial')t.value='parcial';}}); openModal('modal-manual');
}
async function guardarRegistroManual() {
  const i=document.getElementById('manual-alumno').value, m=document.getElementById('manual-materia').value, t=document.getElementById('manual-tipo').value, c=document.getElementById('manual-calificacion').value;
  if(!i||!m||!t||!c) return toast('Completa los campos','warning'); showProgress(30); const r=await py('registrar_manual',{mip_id:i,materia:m,tipo_registro:t,calificacion:c}); showProgress(100);
  if(r.ok){toast('✓ Guardado','success');closeModal('modal-manual');cargarTablaGlobal();} else toast('Error','error');
}
function abrirModalCampana(ctx) {
  if (ctx === 'rotacion') { toast('La campana no está disponible para Rotaciones.', 'warning'); return; }
  document.getElementById('campana-contexto').value=ctx; const t=document.getElementById('campana-tipo'); Array.from(t.options).forEach(o=>{o.style.display=o.value==='rotacion'?'none':'block';if(o.value==='parcial')t.value='parcial';}); openModal('modal-campana');
}
async function ejecutarCampana() {
  const m=document.getElementById('campana-materia').value, t=document.getElementById('campana-tipo').value, b=document.getElementById('campana-base').value; if(!b||b<=0)return toast('Base inválida','warning');
  confirmDialog('Aplicar Campana',`¿Elevar a ${b}? Modificará la BD permanente.`, async ()=>{ showProgress(30); const r=await py('aplicar_campana',{materia:m,tipo_registro:t,cal_base:b}); showProgress(100); if(r.ok){toast('✓ Campana lista','success');closeModal('modal-campana');cargarTablaGlobal();} else toast(r.error,'error'); });
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
    tipoSel.value = 'parcial'; // reset to safe default
    tipoSel.disabled = true;
  } else {
    tipoSel.disabled = false;
  }
}

async function exportarResultadosExamen() {
  const mat = document.getElementById('exam-res-materia').value, tip = document.getElementById('exam-res-tipo').value;
  showProgress(30); const r = await py('exportar_resultados_examen', { materia: mat, tipo_examen: tip, export_type: 'excel' }); showProgress(100);
  if (r.ok || r.data?.path) { toast(`✓ Excel generado correctamente`, 'success'); window.api.openFile(r.data?.path || r.path); } else toast('Error al exportar', 'error');
}

// ── CALIFICACIONES GLOBALES Y MEGA TABLA (UNIFICADA) ──
function filtrarCalGlobal(gr, ctx) { 
  calGrado=gr; 
  if(ctx){ctx.closest('.tab-group').querySelectorAll('button').forEach(b=>b.classList.remove('active')); ctx.classList.add('active');} 
  cargarTablaGlobal(); 
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
   document.getElementById('thead-cal-global').innerHTML=`<tr><th rowspan="2">Nombre</th><th rowspan="2">ID</th><th rowspan="2">Grado</th>${MAT.map(m=>`<th colspan="4" style="text-align:center;background:${cMap[m.lbl]}; color:var(--c-text-th)">${m.lbl}</th>`).join('')}<th rowspan="2" style="background:var(--azul-light); text-align:center;">Entregas<br>(15%)</th><th rowspan="2" style="background:var(--dorado);color:#222; text-align:center;">Final</th></tr><tr>${MAT.map(()=>'<th>Rot</th><th>Parcial</th><th>Final</th><th>Total</th>').join('')}</tr>`;
   const OPTS = `<option value="">—</option><option value="excelente">😊 Ex (100)</option><option value="bien">🙂 Bn (85)</option><option value="decente">😐 Dec (70)</option><option value="deficiente">😕 Def (50)</option><option value="no_participa">❌ NP (0)</option>`;
   document.getElementById('tbody-cal-global').innerHTML = fGlobal.map(row=> `<tr><td style="text-align:left;">${row.nombre_completo||''}</td><td><code>${row.mip_id}</code></td><td><span class="badge-${row.grado==='MIP 1'?'mip1':'mip2'}">${row.grado}</span></td>${MAT.map(m=>`<td>${gradePill(row[m.rot])}</td><td>${gradePill(row[m.pa])}</td><td>${gradePill(row[m.fi])}</td><td style="font-weight:bold">${gradePill(row[m.tot])}</td>`).join('')}<td><select class="select-rubrica" onchange="setRubricaGlobal('${row.mip_id}',this.value)">${OPTS.replace(`value="${row.rubrica_entregas_global||''}"`, `value="${row.rubrica_entregas_global||''}" selected`)}</select></td><td style="font-weight:bold; font-size:14px;">${gradePill(row.cal_final_global)}</td></tr>`).join('')||'<tr><td colspan="30" class="text-muted text-center">Vacio</td></tr>';

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
async function exportarExcel(t) { showProgress(30); const r=await py('exportar_excel',{tipo:t,grado:calGrado||null, usar_troncal: document.getElementById('check-troncal').checked}); showProgress(100); if(r.ok){toast('✓ Guardado','success');window.api.openFile(r.data.path);}else toast('Error','error'); }

async function cargarGraficosExamen() {
  const mat = document.getElementById('cal-exam-materia').value, tip = document.getElementById('cal-exam-tipo').value;
  const r = await py('get_tabla_examenes', { materia:mat, tipo_examen:tip }); const tb = r.data?.tabla || [];
  if(chartUniv) chartUniv.destroy(); if(chartDist) chartDist.destroy();
  const uM = {}; tb.forEach(r=>{ const u=r.universidad||'OTROS'; if(!uM[u])uM[u]=[]; if(r.mip1_score!==null)uM[u].push(parseFloat(r.mip1_score)); if(r.mip2_score!==null)uM[u].push(parseFloat(r.mip2_score)); });
  const l1=Object.keys(uM), d1=l1.map(u=>uM[u].reduce((a,b)=>a+b,0)/uM[u].length||0);
  chartUniv = new Chart(document.getElementById('chart-por-universidad').getContext('2d'), { type:'bar', data:{labels:l1,datasets:[{label:'Promedio',data:d1,backgroundColor:'#2C4F7C',borderRadius:6}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{title:{display:true,text:`${mat} ${tip}`,color:getComputedStyle(document.documentElement).getPropertyValue('--text')}},scales:{y:{min:0,max:100}}} });
  const b={'0-49':0,'50-59':0,'60-69':0,'70-79':0,'80-89':0,'90-100':0}; tb.forEach(r=>{ [r.mip1_score, r.mip2_score].forEach(v=>{const val=parseFloat(v); if(isNaN(val))return; if(val<50)b['0-49']++;else if(val<60)b['50-59']++;else if(val<70)b['60-69']++;else if(val<80)b['70-79']++;else if(val<90)b['80-89']++;else b['90-100']++;}) });
  chartDist = new Chart(document.getElementById('chart-distribucion').getContext('2d'), { type:'doughnut', data:{labels:Object.keys(b),datasets:[{data:Object.values(b),backgroundColor:['#e74c3c','#e67e22','#f1c40f','#27ae60','#2C4F7C','#4A7C59']}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}} });
  const top = await py('get_top_3_examenes');
  document.getElementById('top-mip2-list').innerHTML = (top.data?.mip2||[]).map((x,i)=>`<div style="display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid var(--border); padding-bottom:4px;"><span>${i===0?'🥇':i===1?'🥈':'🥉'} <b>${x.nombre}</b> <br><small class="text-muted">${x.escuela}</small></span><span style="font-weight:bold; color:var(--verde)">${Math.floor(parseFloat(x.prom) + 0.5)}</span></div>`).join('')||'<span class="text-muted">No hay datos</span>';
  document.getElementById('top-mip1-list').innerHTML = (top.data?.mip1||[]).map((x,i)=>`<div style="display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid var(--border); padding-bottom:4px;"><span>${i===0?'🥇':i===1?'🥈':'🥉'} <b>${x.nombre}</b> <br><small class="text-muted">${x.escuela}</small></span><span style="font-weight:bold; color:var(--verde)">${Math.floor(parseFloat(x.prom) + 0.5)}</span></div>`).join('')||'<span class="text-muted">No hay datos</span>';
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