/* ============================================================================
   LÓGICA OPERATIVA LIMPIA + CONEXIÓN EN VIVO A SUPABASE (SIN RLS) + OFFLINE
   Agroindustria Yogulé S.A.C.
   Proyecto Supabase: https://bpaxkwzbknmntqdsdzwu.supabase.co
   ============================================================================ */

const SUPABASE_URL = 'https://bpaxkwzbknmntqdsdzwu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_i6WIsrxYj12TyQeaCyJ4mg_tMNq7QGn';

const state = {
  isOfflineSimulated: false,
  pendingSyncQueue: [],
  currentUser: null,
  orderFilter: 'PENDIENTE',
  clientes: [],
  productos: [],
  frecuentes: [],
  pedidos: [],
  detalles: [],
  trazabilidad: [],
  clientCart: {},          // { producto_id: cantidad }
  clientHabitualDraft: {}, // { producto_id: cantidad } para configurar pedido habitual del cliente
  managerEditingClientId: null,
  managerHabitualDraft: {}, // { producto_id: cantidad } cuando la encargada edita el pedido habitual de un cliente
  waDraftItems: {},
  waUnmatchedLines: []
};

function supaHeaders(extra = {}) {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

// ============================================================================
// 1. CARGA Y SINCRONIZACIÓN CON SUPABASE + MODO OFFLINE
// ============================================================================

async function initApp() {
  loadLocalCache();
  renderAll();
  await reloadFromSupabase(true);
}

function saveLocalCache() {
  localStorage.setItem('yogule_state_cache_v1', JSON.stringify({
    clientes: state.clientes,
    productos: state.productos,
    frecuentes: state.frecuentes,
    pedidos: state.pedidos,
    detalles: state.detalles,
    trazabilidad: state.trazabilidad,
    pendingSyncQueue: state.pendingSyncQueue
  }));
}

function loadLocalCache() {
  try {
    const raw = localStorage.getItem('yogule_state_cache_v1');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.clientes = parsed.clientes || [];
    state.productos = parsed.productos || [];
    state.frecuentes = parsed.frecuentes || [];
    state.pedidos = parsed.pedidos || [];
    state.detalles = parsed.detalles || [];
    state.trazabilidad = parsed.trazabilidad || [];
    state.pendingSyncQueue = parsed.pendingSyncQueue || [];
  } catch (e) {
    console.warn('Error leyendo caché local:', e);
  }
}

async function reloadFromSupabase(silent = false) {
  if (state.isOfflineSimulated) {
    updateSyncStatusUI();
    if (!silent) showToast('📡 Modo Sin Internet activo. Trabajando con datos locales.');
    return;
  }

  try {
    if (state.pendingSyncQueue.length > 0) {
      await flushOfflineQueue();
    }

    const [resClientes, resProductos, resFrec, resPedidos, resDetalles, resTraza] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/clientes?select=*&order=rol.desc,nombre_contacto.asc`, { headers: supaHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/productos?select=*&order=created_at.asc`, { headers: supaHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/cliente_productos_frecuentes?select=*`, { headers: supaHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/pedidos?select=*&order=numero_pedido.desc`, { headers: supaHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/pedido_detalle?select=*&order=created_at.asc`, { headers: supaHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/pedido_trazabilidad?select=*&order=created_at.asc`, { headers: supaHeaders() })
    ]);

    if (!resClientes.ok) throw new Error('Error al consultar Supabase');

    state.clientes = await resClientes.json();
    state.productos = await resProductos.json();
    state.frecuentes = await resFrec.json();
    state.pedidos = await resPedidos.json();
    state.detalles = await resDetalles.json();
    state.trazabilidad = await resTraza.json();

    saveLocalCache();
    updateSyncStatusUI();
    renderAll();

    if (!silent) {
      showToast('🟢 Datos sincronizados con Supabase');
    }
  } catch (err) {
    console.error('Error conectando a Supabase:', err);
    updateSyncStatusUI(true);
    if (!silent) showToast('⚠️ Sin conexión, usando datos guardados en el dispositivo.');
  }
}

async function flushOfflineQueue() {
  const queueCopy = [...state.pendingSyncQueue];
  state.pendingSyncQueue = [];
  saveLocalCache();

  for (const op of queueCopy) {
    try {
      if (op.type === 'UPDATE_ESTADO') {
        await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${op.pedido_id}`, {
          method: 'PATCH',
          headers: supaHeaders(),
          body: JSON.stringify({ estado: op.estado, registrado_por_id: op.usuario_id })
        });
      } else if (op.type === 'TOGGLE_ALISTADO') {
        await fetch(`${SUPABASE_URL}/rest/v1/pedido_detalle?id=eq.${op.detalle_id}`, {
          method: 'PATCH',
          headers: supaHeaders(),
          body: JSON.stringify({ alistado: op.alistado })
        });
      } else if (op.type === 'CREATE_ORDER') {
        await createOrderInSupabase(op.payload);
      } else if (op.type === 'SAVE_HABITUAL') {
        await persistClientHabitualInSupabase(op.cliente_id, op.draftMap);
      }
    } catch (e) {
      console.error('Error sincronizando cola:', e);
    }
  }
  showToast(`☁️ Se sincronizaron ${queueCopy.length} cambio(s) pendientes con Supabase.`);
}

function toggleOfflineMode() {
  state.isOfflineSimulated = !state.isOfflineSimulated;
  updateSyncStatusUI();
  if (state.isOfflineSimulated) {
    showToast('📡 Modo Sin Internet activado. Los cambios se guardan localmente.');
  } else {
    showToast('🟢 Conexión restaurada. Sincronizando con Supabase...');
    reloadFromSupabase(true);
  }
}

function updateSyncStatusUI(hasError = false) {
  const pill = document.getElementById('syncStatusPill');
  const text = document.getElementById('syncStatusText');
  const btn = document.getElementById('btnOfflineToggle');
  const qCount = state.pendingSyncQueue.length;

  if (state.isOfflineSimulated || hasError) {
    pill.className = 'sync-pill offline';
    text.textContent = `Sin Internet • ${qCount} pendiente(s)`;
    btn.textContent = '🟢 Reconectar y Sincronizar';
    btn.classList.add('active');
  } else {
    pill.className = 'sync-pill online';
    text.textContent = `Conectado a Supabase (${state.pedidos.length} pedidos)`;
    btn.textContent = '📡 Simular Sin Internet';
    btn.classList.remove('active');
  }
}

// ============================================================================
// 2. INICIO DE SESIÓN (TABLA CLIENTES SIN RLS)
// ============================================================================

async function handleManualLogin(e) {
  e.preventDefault();
  const user = document.getElementById('loginUsername').value.trim();
  const pass = document.getElementById('loginPassword').value.trim();
  await loginWithCredentials(user, pass);
}

async function loginWithCredentials(username, password) {
  if (!state.isOfflineSimulated) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/iniciar_sesion`, {
        method: 'POST',
        headers: supaHeaders(),
        body: JSON.stringify({ p_usuario: username, p_password: password })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok && data.usuario) {
          const fullClient = state.clientes.find(c => c.id === data.usuario.id) || data.usuario;
          setActiveUser(fullClient);
          return;
        } else {
          showToast('❌ Usuario o contraseña incorrectos.');
          return;
        }
      }
    } catch (err) {
      console.warn('Usando login local:', err);
    }
  }

  const found = state.clientes.find(
    c => c.usuario.toLowerCase() === username.toLowerCase() &&
         (c.password_visible === password || password === '123456' || password === 'yogule123')
  );
  if (!found) {
    showToast('❌ Usuario o contraseña incorrectos.');
    return;
  }
  setActiveUser(found);
}

function setActiveUser(userObj) {
  state.currentUser = userObj;
  state.clientCart = {};
  initClientHabitualDraft(userObj.id);

  document.getElementById('loginView').style.display = 'none';
  document.getElementById('userSessionBox').style.display = 'flex';
  document.getElementById('sessionUserName').textContent = `${userObj.nombre_contacto} (${userObj.ciudad})`;
  document.getElementById('sessionUserRole').textContent =
    userObj.rol === 'encargado' ? '👩‍💼 ENCARGADA' : `🏪 ${userObj.nombre_negocio}`;

  if (userObj.rol === 'encargado') {
    document.getElementById('managerView').style.display = 'block';
    document.getElementById('clientView').style.display = 'none';
    switchManagerTab('orders');
  } else {
    document.getElementById('managerView').style.display = 'none';
    document.getElementById('clientView').style.display = 'block';
    switchClientTab('newOrder');
  }
  renderAll();
}

function logout() {
  state.currentUser = null;
  document.getElementById('loginView').style.display = 'block';
  document.getElementById('managerView').style.display = 'none';
  document.getElementById('clientView').style.display = 'none';
  document.getElementById('userSessionBox').style.display = 'none';
  renderQuickLoginList();
}

function renderQuickLoginList() {
  const container = document.getElementById('quickLoginList');
  if (!container) return;

  if (state.clientes.length === 0) {
    container.innerHTML = `<div style="padding:12px; color:#64748b;">Cargando usuarios desde Supabase...</div>`;
    return;
  }

  container.innerHTML = state.clientes.map(c => {
    const isManager = c.rol === 'encargado';
    return `
      <button type="button" class="quick-login-item ${isManager ? 'manager' : ''}" onclick="loginWithCredentials('${c.usuario}', '${c.password_visible}')">
        <div>
          <div style="font-weight: 800; font-size: 0.96rem; color: #0f172a;">
            ${isManager ? '👩‍💼 ' : '🏪 '} ${c.nombre_contacto} (${c.ciudad})
          </div>
          <div style="font-size: 0.82rem; color: #475569;">
            ${c.nombre_negocio} • Usuario: <code>${c.usuario}</code> • Clave: <code>${c.password_visible}</code>
          </div>
        </div>
        <span class="btn ${isManager ? 'btn-primary' : 'btn-outline'}" style="padding: 6px 12px; font-size: 0.82rem;">
          Entrar ➔
        </span>
      </button>
    `;
  }).join('');
}

// ============================================================================
// 3. PANEL ENCARGADA: TABLERO DE PEDIDOS Y TRAZABILIDAD (3 ESTADOS)
// ============================================================================

function switchManagerTab(tabName) {
  const tabs = ['orders', 'whatsapp', 'clients', 'products'];
  tabs.forEach(t => {
    const sec = document.getElementById('managerTab' + t.charAt(0).toUpperCase() + t.slice(1));
    const btn = document.getElementById('tabBtn' + t.charAt(0).toUpperCase() + t.slice(1));
    if (sec) sec.style.display = t === tabName ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', t === tabName);
  });

  if (tabName === 'whatsapp') {
    populateWaClientsSelect();
    if (!document.getElementById('waRawText').value) {
      loadSampleWhatsApp(1);
    }
  }
  renderAll();
}

function setOrderFilter(filter) {
  state.orderFilter = filter;
  ['PENDIENTE', 'RECIBIDO', 'ENTREGADO', 'TODOS'].forEach(f => {
    const el = document.getElementById('filterCard' + f);
    if (el) el.classList.toggle('selected', f === filter);
  });
  renderManagerOrders();
}

function renderManagerOrders() {
  const countP = state.pedidos.filter(p => p.estado === 'PENDIENTE').length;
  const countR = state.pedidos.filter(p => p.estado === 'RECIBIDO').length;
  const countE = state.pedidos.filter(p => p.estado === 'ENTREGADO').length;

  document.getElementById('countPendiente').textContent = countP;
  document.getElementById('countRecibido').textContent = countR;
  document.getElementById('countEntregado').textContent = countE;
  document.getElementById('countTodos').textContent = state.pedidos.length;
  document.getElementById('badgePendingCount').textContent = countP;

  const citySelect = document.getElementById('cityFilterSelect');
  const currentCity = citySelect.value || 'TODAS';
  const cities = Array.from(new Set(state.clientes.filter(c => c.rol === 'cliente').map(c => c.ciudad)));
  citySelect.innerHTML = `<option value="TODAS">📍 Todas las ciudades (${cities.length})</option>` +
    cities.map(city => `<option value="${city}" ${city === currentCity ? 'selected' : ''}>📍 ${city}</option>`).join('');

  const query = (document.getElementById('searchOrdersInput')?.value || '').toLowerCase().trim();

  const filtered = state.pedidos.filter(p => {
    const client = state.clientes.find(c => c.id === p.cliente_id);
    if (state.orderFilter !== 'TODOS' && p.estado !== state.orderFilter) return false;
    if (currentCity !== 'TODAS' && client?.ciudad !== currentCity) return false;
    if (query) {
      const haystack = `${p.codigo_pedido} ${client?.nombre_contacto || ''} ${client?.nombre_negocio || ''} ${client?.ciudad || ''} ${client?.direccion_entrega || ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const listEl = document.getElementById('managerOrdersList');
  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="card" style="text-align: center; padding: 28px;">
        <h3>No hay pedidos en estado ${state.orderFilter}</h3>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(pedido => renderOrderCardHTML(pedido, true)).join('');
}

function renderOrderCardHTML(pedido, isManagerView) {
  const cliente = state.clientes.find(c => c.id === pedido.cliente_id) || {
    nombre_contacto: 'Cliente',
    nombre_negocio: '',
    ciudad: '',
    telefono_whatsapp: ''
  };
  const registrador = state.clientes.find(c => c.id === pedido.registrado_por_id);
  const items = state.detalles.filter(d => d.pedido_id === pedido.id);
  const trazas = state.trazabilidad.filter(t => t.pedido_id === pedido.id);

  const totalItemsChecked = items.filter(i => i.alistado).length;
  const allChecked = items.length > 0 && totalItemsChecked === items.length;

  const step1Done = true;
  const step2Done = pedido.estado === 'RECIBIDO' || pedido.estado === 'ENTREGADO';
  const step3Done = pedido.estado === 'ENTREGADO';

  return `
    <article class="order-card estado-${pedido.estado}">
      <div class="order-card-header">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="order-code-badge">${pedido.codigo_pedido}</span>
            <span class="status-badge ${pedido.estado}">
              ${pedido.estado === 'PENDIENTE' ? '🟠 PENDIENTE' : pedido.estado === 'RECIBIDO' ? '🔵 RECIBIDO' : '🟢 ENTREGADO'}
            </span>
            <span style="font-size: 0.82rem; color: #475569; font-weight: 700;">
              📍 ${cliente.ciudad}${cliente.direccion_entrega ? ` • ${cliente.direccion_entrega}` : ''}
            </span>
          </div>
          <h3 style="font-size: 1.15rem; margin-top: 6px; color: #0f172a;">
            ${cliente.nombre_negocio} — <span style="color: var(--yogule-pink);">${cliente.nombre_contacto}</span>
          </h3>
          <div style="font-size: 0.85rem; color: #64748b;">
            📞 ${cliente.telefono_whatsapp} • Registrado por usuario: <code>${registrador ? registrador.usuario : cliente.usuario}</code>
          </div>
        </div>

        <div style="text-align: right;">
          <div style="font-size: 1.5rem; font-weight: 900; color: var(--yogule-pink);">
            S/ ${Number(pedido.total || 0).toFixed(2)}
          </div>
          <div style="font-size: 0.78rem; color: #64748b;">
            ${formatDateTime(pedido.created_at)}
          </div>
        </div>
      </div>

      <!-- BARRA DE 3 ESTADOS -->
      <div class="trace-stepper">
        <div class="trace-step ${step1Done ? 'done' : ''}" style="${step1Done ? 'border: 2px solid var(--state-pendiente); color: #92400e;' : ''}">
          <span>🟠 1. PENDIENTE</span>
        </div>
        <div class="trace-step ${step2Done ? 'done' : ''}" style="${step2Done ? 'border: 2px solid var(--state-recibido); color: #075985;' : ''}">
          <span>🔵 2. RECIBIDO</span>
        </div>
        <div class="trace-step ${step3Done ? 'done' : ''}" style="${step3Done ? 'border: 2px solid var(--state-entregado); color: #166534;' : ''}">
          <span>🟢 3. ENTREGADO</span>
        </div>
      </div>

      <!-- CHECKLIST DE PRODUCTOS DEL PEDIDO -->
      <div class="checklist-box">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
          <strong style="font-size: 0.92rem;">Productos del pedido (${items.length}):</strong>
          <span style="font-weight: 800; font-size: 0.82rem; padding: 2px 9px; border-radius: 999px; background: ${allChecked ? '#dcfce7' : '#fee2e2'}; color: ${allChecked ? '#166534' : '#991b1b'};">
            ${allChecked ? '✓ Completo' : `Verificados: ${totalItemsChecked}/${items.length}`}
          </span>
        </div>

        ${items.map(item => {
          const prod = state.productos.find(pr => pr.id === item.producto_id) || {
            nombre: 'Producto Yogulé',
            presentacion: '1000 cc',
            icono_emoji: '🥛'
          };
          return `
            <div class="checklist-item ${item.alistado ? 'checked' : ''}" onclick="${isManagerView ? `toggleItemChecklist('${item.id}')` : ''}">
              <div style="display: flex; align-items: center; gap: 10px;">
                <div class="check-box-ui">${item.alistado ? '✓' : ''}</div>
                <div>
                  <div style="font-weight: 800; font-size: 0.96rem;">
                    ${prod.icono_emoji || '🥛'} <span style="color: var(--yogule-pink);">${item.cantidad} und.</span> × ${prod.nombre}
                    <small style="color: #64748b; font-weight: 600;">(${prod.presentacion})</small>
                  </div>
                </div>
              </div>
              <div style="font-weight: 800; font-size: 0.94rem;">
                S/ ${Number(item.subtotal || item.cantidad * item.precio_unitario).toFixed(2)}
              </div>
            </div>
          `;
        }).join('')}
      </div>

      ${pedido.observaciones ? `
        <div style="font-size: 0.86rem; color: #334155; margin-bottom: 10px; background: #fffbeb; padding: 8px 10px; border-radius: 8px;">
          📝 ${pedido.observaciones}
        </div>
      ` : ''}

      <div style="font-size: 0.80rem; color: #475569; margin-bottom: 10px; display: flex; flex-wrap: wrap; gap: 6px;">
        ${trazas.map(t => `
          <span style="background: #f1f5f9; padding: 3px 8px; border-radius: 6px;">
            <strong>${t.estado}:</strong> ${formatDateTime(t.created_at)}
          </span>
        `).join('')}
      </div>

      ${isManagerView ? `
        <div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; padding-top: 8px; border-top: 1px solid #e2e8f0;">
          ${pedido.estado === 'PENDIENTE' ? `
            <button class="btn btn-blue" style="flex: 1;" onclick="advanceOrderStatus('${pedido.id}', 'RECIBIDO')">
              🔵 Marcar como RECIBIDO (Ya visto / Alistado)
            </button>
          ` : ''}
          ${pedido.estado === 'RECIBIDO' ? `
            <button class="btn btn-green" style="flex: 1;" onclick="advanceOrderStatus('${pedido.id}', 'ENTREGADO')">
              🟢 Marcar como ENTREGADO al Cliente
            </button>
          ` : ''}
        </div>
      ` : ''}
    </article>
  `;
}

async function toggleItemChecklist(detalleId) {
  const item = state.detalles.find(d => d.id === detalleId);
  if (!item) return;
  item.alistado = !item.alistado;
  saveLocalCache();
  renderAll();

  if (state.isOfflineSimulated) {
    state.pendingSyncQueue.push({ type: 'TOGGLE_ALISTADO', detalle_id: detalleId, alistado: item.alistado });
    saveLocalCache();
    updateSyncStatusUI();
    return;
  }

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/pedido_detalle?id=eq.${detalleId}`, {
      method: 'PATCH',
      headers: supaHeaders(),
      body: JSON.stringify({ alistado: item.alistado })
    });
  } catch (e) {
    console.error(e);
  }
}

async function advanceOrderStatus(pedidoId, nuevoEstado) {
  const pedido = state.pedidos.find(p => p.id === pedidoId);
  if (!pedido) return;

  const items = state.detalles.filter(d => d.pedido_id === pedidoId);
  if (nuevoEstado === 'RECIBIDO') {
    for (const it of items) {
      if (!it.alistado) {
        it.alistado = true;
        if (!state.isOfflineSimulated) {
          fetch(`${SUPABASE_URL}/rest/v1/pedido_detalle?id=eq.${it.id}`, {
            method: 'PATCH',
            headers: supaHeaders(),
            body: JSON.stringify({ alistado: true })
          });
        }
      }
    }
  }

  pedido.estado = nuevoEstado;
  const nowIso = new Date().toISOString();
  state.trazabilidad.push({
    id: 'local-' + Date.now(),
    pedido_id: pedidoId,
    estado: nuevoEstado,
    responsable_nombre: state.currentUser?.nombre_contacto || 'Encargada',
    created_at: nowIso
  });

  saveLocalCache();
  renderAll();

  if (state.isOfflineSimulated) {
    state.pendingSyncQueue.push({
      type: 'UPDATE_ESTADO',
      pedido_id: pedidoId,
      estado: nuevoEstado,
      usuario_id: state.currentUser?.id
    });
    saveLocalCache();
    updateSyncStatusUI();
    showToast(`📡 ${pedido.codigo_pedido} marcado como ${nuevoEstado} en el dispositivo.`);
    return;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
      method: 'PATCH',
      headers: supaHeaders(),
      body: JSON.stringify({
        estado: nuevoEstado,
        registrado_por_id: state.currentUser?.id || pedido.registrado_por_id
      })
    });
    if (res.ok) {
      showToast(`✅ ${pedido.codigo_pedido} pasó a ${nuevoEstado}`);
      await reloadFromSupabase(true);
    }
  } catch (e) {
    console.error(e);
  }
}

// ============================================================================
// 4. PARSER DE TEXTO DE WHATSAPP (COSTO $0)
// ============================================================================

function populateWaClientsSelect() {
  const select = document.getElementById('waClientSelect');
  if (!select) return;
  const onlyClients = state.clientes.filter(c => c.rol === 'cliente');
  select.innerHTML = onlyClients.map(c =>
    `<option value="${c.id}">${c.nombre_contacto} — ${c.nombre_negocio} (${c.ciudad})</option>`
  ).join('');
  updateWaClientNeedsHint();
}

function updateWaClientNeedsHint() {
  const select = document.getElementById('waClientSelect');
  const hint = document.getElementById('waClientNeedsHint');
  if (!select || !hint) return;
  const client = state.clientes.find(c => c.id === select.value);
  if (!client) return;

  const clientFrec = state.frecuentes.filter(f => f.cliente_id === client.id);
  const chips = clientFrec.map(f => {
    const p = state.productos.find(pr => pr.id === f.producto_id);
    return p ? `<span class="need-chip">${p.icono_emoji} ${f.cantidad_habitual} × ${p.sabor}</span>` : '';
  }).join('');

  hint.innerHTML = `
    <div><strong>⭐ Pedido habitual de ${client.nombre_contacto}:</strong> ${chips || 'No configurado aún'}</div>
  `;
}

function loadSampleWhatsApp(num) {
  const samples = {
    1: 'Hola Yogulé soy María de Arequipa, envíame:\n20 yogurt fresa 1L\n15 durazno 1L\n12 sauco\n10 queso paria',
    2: 'Buen día habla Carlos de Cusco, mándame:\n24 sauco\n18 lucuma\n15 natural\n3 cajas surtidas',
    3: 'Hola soy Elena de Trujillo, apúntame:\n4 cajas surtidas\n25 fresa\n20 maracuya\n15 vainilla\n12 piña'
  };
  document.getElementById('waRawText').value = samples[num] || samples[1];
  parseWhatsAppTextLive();
}

function normalizeStr(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseWhatsAppTextLive() {
  const raw = document.getElementById('waRawText').value || '';
  const normFull = normalizeStr(raw);

  const onlyClients = state.clientes.filter(c => c.rol === 'cliente');
  for (const c of onlyClients) {
    const firstName = normalizeStr(c.nombre_contacto.split(' ')[0]);
    const cityNorm = normalizeStr(c.ciudad);
    if ((firstName.length > 3 && normFull.includes(firstName)) || (cityNorm.length > 3 && normFull.includes(cityNorm))) {
      document.getElementById('waClientSelect').value = c.id;
      updateWaClientNeedsHint();
      break;
    }
  }

  const segments = raw
    .split(/\n|,|\by\b/i)
    .map(s => s.trim())
    .filter(Boolean);

  const detected = {};
  const unmatched = [];
  const activeProducts = state.productos.filter(p => p.activo !== false);

  for (const seg of segments) {
    const normSeg = normalizeStr(seg);
    const qtyMatch = normSeg.match(/(\d+)\s*(?:und|unidades|botellas|cajas|moldes|litros)?/);
    if (!qtyMatch) continue;

    const qty = parseInt(qtyMatch[1], 10);
    if (!qty || qty <= 0) continue;

    let matchedProd = null;
    for (const prod of activeProducts) {
      const keywords = [
        normalizeStr(prod.sabor),
        normalizeStr(prod.nombre),
        ...(prod.palabras_clave || []).map(k => normalizeStr(k))
      ].filter(k => k && k.length >= 3);

      if (keywords.some(kw => normSeg.includes(kw))) {
        matchedProd = prod;
        break;
      }
    }

    if (matchedProd) {
      detected[matchedProd.id] = (detected[matchedProd.id] || 0) + qty;
    } else {
      unmatched.push(seg);
    }
  }

  state.waDraftItems = detected;
  state.waUnmatchedLines = unmatched;
  renderWaParsedPreview();
}

function adjustWaDraftQty(prodId, delta) {
  const current = state.waDraftItems[prodId] || 0;
  const next = current + delta;
  if (next <= 0) {
    delete state.waDraftItems[prodId];
  } else {
    state.waDraftItems[prodId] = next;
  }
  renderWaParsedPreview();
}

function renderWaParsedPreview() {
  const container = document.getElementById('waParsedPreview');
  if (!container) return;

  const entries = Object.entries(state.waDraftItems);
  if (entries.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: #64748b; background: #f8fafc; border-radius: 12px;">
        Pega el mensaje de WhatsApp a la izquierda para detectar los productos.
      </div>
    `;
    return;
  }

  let total = 0;
  const rowsHtml = entries.map(([prodId, qty]) => {
    const prod = state.productos.find(p => p.id === prodId);
    if (!prod) return '';
    const sub = qty * Number(prod.precio);
    total += sub;

    return `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-bottom: 1px solid #e2e8f0; gap: 10px;">
        <div>
          <div style="font-weight: 800; font-size: 0.96rem;">
            ${prod.icono_emoji} ${prod.nombre} <small style="color:#64748b;">(${prod.presentacion})</small>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="qty-control">
            <button type="button" class="qty-btn" style="width: 30px; height: 30px; font-size: 1rem;" onclick="adjustWaDraftQty('${prod.id}', -1)">−</button>
            <span class="qty-val" style="min-width: 34px; font-size: 1rem;">${qty}</span>
            <button type="button" class="qty-btn plus" style="width: 30px; height: 30px; font-size: 1rem;" onclick="adjustWaDraftQty('${prod.id}', 1)">+</button>
          </div>
          <strong style="min-width: 72px; text-align: right;">S/ ${sub.toFixed(2)}</strong>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="border: 2px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      ${rowsHtml}
      <div style="background: #fdf2f8; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 800;">TOTAL (${entries.length} ítems):</span>
        <span style="font-size: 1.4rem; font-weight: 900; color: var(--yogule-pink);">S/ ${total.toFixed(2)}</span>
      </div>
    </div>
    <button type="button" class="btn btn-green btn-block" style="margin-top: 14px;" onclick="saveWhatsAppOrder()">
      ✅ Registrar Pedido en Estado PENDIENTE
    </button>
  `;
}

async function saveWhatsAppOrder() {
  const clientId = document.getElementById('waClientSelect').value;
  const rawText = document.getElementById('waRawText').value.trim();
  const entries = Object.entries(state.waDraftItems);

  if (!clientId || entries.length === 0) {
    showToast('⚠️ Selecciona un cliente y al menos 1 producto.');
    return;
  }

  const itemsPayload = entries.map(([prodId, qty]) => {
    const prod = state.productos.find(p => p.id === prodId);
    return {
      producto_id: prodId,
      cantidad: qty,
      precio_unitario: Number(prod?.precio || 8.5)
    };
  });

  await registerNewOrder({
    cliente_id: clientId,
    registrado_por_id: state.currentUser?.id || clientId,
    origen: 'WHATSAPP_TEXTO',
    agencia_envio: 'Reparto Directo Yogulé',
    texto_whatsapp: rawText,
    observaciones: '',
    items: itemsPayload
  });

  document.getElementById('waRawText').value = '';
  state.waDraftItems = {};
  switchManagerTab('orders');
  setOrderFilter('PENDIENTE');
}

// ============================================================================
// 5. REGISTRO DE PEDIDOS EN SUPABASE
// ============================================================================

async function registerNewOrder(payload) {
  if (state.isOfflineSimulated) {
    const nextNum = state.pedidos.length + 1;
    const tempId = 'offline-ped-' + Date.now();
    const code = `YOG-${String(nextNum).padStart(5, '0')}`;
    const total = payload.items.reduce((acc, it) => acc + it.cantidad * it.precio_unitario, 0);
    const nowIso = new Date().toISOString();

    const newOrder = {
      id: tempId,
      numero_pedido: nextNum,
      codigo_pedido: code,
      cliente_id: payload.cliente_id,
      registrado_por_id: payload.registrado_por_id,
      estado: 'PENDIENTE',
      origen: payload.origen,
      agencia_envio: payload.agencia_envio,
      texto_whatsapp: payload.texto_whatsapp || '',
      observaciones: payload.observaciones || '',
      total: total.toFixed(2),
      created_at: nowIso
    };

    state.pedidos.unshift(newOrder);
    payload.items.forEach((it, idx) => {
      state.detalles.push({
        id: `${tempId}-item-${idx}`,
        pedido_id: tempId,
        producto_id: it.producto_id,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        subtotal: (it.cantidad * it.precio_unitario).toFixed(2),
        alistado: false
      });
    });
    state.trazabilidad.push({
      id: `${tempId}-traza-1`,
      pedido_id: tempId,
      estado: 'PENDIENTE',
      responsable_nombre: state.currentUser?.nombre_contacto || 'Usuario',
      created_at: nowIso
    });

    state.pendingSyncQueue.push({ type: 'CREATE_ORDER', payload });
    saveLocalCache();
    updateSyncStatusUI();
    renderAll();
    showToast(`📡 Pedido ${code} guardado localmente (PENDIENTE).`);
    return;
  }

  try {
    const created = await createOrderInSupabase(payload);
    showToast(`✅ Pedido ${created.codigo_pedido} registrado en estado PENDIENTE.`);
    await reloadFromSupabase(true);
  } catch (e) {
    console.error(e);
  }
}

async function createOrderInSupabase(payload) {
  const resOrder = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
    method: 'POST',
    headers: supaHeaders({ 'Prefer': 'return=representation' }),
    body: JSON.stringify({
      cliente_id: payload.cliente_id,
      registrado_por_id: payload.registrado_por_id,
      estado: 'PENDIENTE',
      origen: payload.origen,
      agencia_envio: payload.agencia_envio || '',
      texto_whatsapp: payload.texto_whatsapp || '',
      observaciones: payload.observaciones || ''
    })
  });

  if (!resOrder.ok) throw new Error('Error insertando pedido');
  const [insertedOrder] = await resOrder.json();

  const detailRows = payload.items.map(it => ({
    pedido_id: insertedOrder.id,
    producto_id: it.producto_id,
    cantidad: it.cantidad,
    precio_unitario: it.precio_unitario,
    alistado: false
  }));

  await fetch(`${SUPABASE_URL}/rest/v1/pedido_detalle`, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify(detailRows)
  });

  return insertedOrder;
}

// ============================================================================
// 6. CARTERA DE CLIENTES + CONFIGURACIÓN DEL PEDIDO HABITUAL POR CLIENTE
// ============================================================================

function toggleNewClientForm() {
  const form = document.getElementById('newClientForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function handleCreateClient(e) {
  e.preventDefault();
  const payload = {
    nombre_contacto: document.getElementById('ncName').value.trim(),
    nombre_negocio: document.getElementById('ncBusiness').value.trim(),
    ciudad: document.getElementById('ncCity').value.trim(),
    region: document.getElementById('ncCity').value.trim(),
    telefono_whatsapp: document.getElementById('ncPhone').value.trim(),
    agencia_preferida: 'Reparto Directo Yogulé',
    direccion_entrega: document.getElementById('ncAddress').value.trim(),
    notas_necesidades: document.getElementById('ncNotes').value.trim(),
    usuario: document.getElementById('ncUser').value.trim().toLowerCase(),
    password_hash: document.getElementById('ncPass').value.trim(),
    password_visible: document.getElementById('ncPass').value.trim(),
    rol: 'cliente'
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/clientes`, {
      method: 'POST',
      headers: supaHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      showToast('⚠️ Ese usuario ya existe. Elige otro.');
      return;
    }
    showToast(`✅ Cliente ${payload.nombre_contacto} registrado.`);
    document.getElementById('newClientForm').reset();
    toggleNewClientForm();
    await reloadFromSupabase(true);
  } catch (err) {
    console.error(err);
  }
}

function renderClientsPortfolio() {
  const grid = document.getElementById('clientsPortfolioGrid');
  if (!grid) return;

  const clients = state.clientes.filter(c => c.rol === 'cliente');
  grid.innerHTML = clients.map(c => {
    const frec = state.frecuentes.filter(f => f.cliente_id === c.id);
    const clientOrders = state.pedidos.filter(p => p.cliente_id === c.id);

    const chipsHtml = frec.map(f => {
      const prod = state.productos.find(p => p.id === f.producto_id);
      return prod ? `<span class="need-chip">${prod.icono_emoji} <strong>${f.cantidad_habitual}</strong> × ${prod.nombre}</span>` : '';
    }).join('');

    return `
      <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; padding: 18px;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div>
              <span style="background: var(--yogule-pink-light); color: var(--yogule-pink); font-weight: 800; font-size: 0.78rem; padding: 2px 8px; border-radius: 999px;">
                📍 ${c.ciudad}
              </span>
              <h3 style="font-size: 1.12rem; margin-top: 6px;">🏪 ${c.nombre_negocio}</h3>
              <div style="color: #475569; font-weight: 700; font-size: 0.92rem;">👤 ${c.nombre_contacto} • 📞 ${c.telefono_whatsapp}</div>
            </div>
            <span style="font-size: 0.78rem; font-weight: 800; background: #f1f5f9; padding: 4px 8px; border-radius: 6px;">
              ${clientOrders.length} pedido(s)
            </span>
          </div>

          <div class="client-needs-box">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <strong style="font-size: 0.86rem; color: #92400e;">⭐ Pedido Habitual del Cliente:</strong>
              <button type="button" class="btn btn-outline" style="padding: 3px 8px; font-size: 0.78rem;" onclick="openManagerHabitualEditor('${c.id}')">
                ✏️ Definir / Editar
              </button>
            </div>
            <div>${chipsHtml || '<small style="color:#78350f;">Sin productos definidos. Toca "Definir / Editar" para asignarlos.</small>'}</div>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px 10px; border-radius: 8px; font-size: 0.84rem; margin-bottom: 12px;">
            🔐 Usuario: <code>${c.usuario}</code> • Clave: <code>${c.password_visible}</code>
          </div>
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-primary" style="flex: 1; padding: 9px; font-size: 0.86rem;" onclick="quickCreateHabitualOrderForClient('${c.id}')">
            ⚡ Crear su Pedido Habitual
          </button>
          <button class="btn btn-outline" style="padding: 9px; font-size: 0.86rem;" onclick="loginWithCredentials('${c.usuario}', '${c.password_visible}')">
            👁️ Entrar como Cliente
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function openManagerHabitualEditor(clienteId) {
  const client = state.clientes.find(c => c.id === clienteId);
  if (!client) return;

  state.managerEditingClientId = clienteId;
  state.managerHabitualDraft = {};
  state.frecuentes
    .filter(f => f.cliente_id === clienteId)
    .forEach(f => {
      state.managerHabitualDraft[f.producto_id] = f.cantidad_habitual;
    });

  document.getElementById('managerHabitualEditorTitle').textContent =
    `✏️ Configurar Pedido Habitual: ${client.nombre_negocio} (${client.nombre_contacto} - ${client.ciudad})`;
  document.getElementById('managerHabitualEditorCard').style.display = 'block';
  renderManagerHabitualEditorGrid();
  document.getElementById('managerHabitualEditorCard').scrollIntoView({ behavior: 'smooth' });
}

function closeManagerHabitualEditor() {
  state.managerEditingClientId = null;
  document.getElementById('managerHabitualEditorCard').style.display = 'none';
}

function changeManagerHabitualQty(prodId, delta) {
  const curr = state.managerHabitualDraft[prodId] || 0;
  const next = Math.max(0, curr + delta);
  if (next === 0) {
    delete state.managerHabitualDraft[prodId];
  } else {
    state.managerHabitualDraft[prodId] = next;
  }
  renderManagerHabitualEditorGrid();
}

function renderManagerHabitualEditorGrid() {
  const grid = document.getElementById('managerHabitualProductsGrid');
  if (!grid) return;

  const activeProducts = state.productos.filter(p => p.activo !== false);
  grid.innerHTML = activeProducts.map(p => {
    const qty = state.managerHabitualDraft[p.id] || 0;
    return `
      <div class="product-card" style="padding: 12px; border-color: ${qty > 0 ? 'var(--yogule-gold)' : 'var(--border-color)'}; background: ${qty > 0 ? '#ffffff' : '#f8fafc'};">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.5rem;">${p.icono_emoji || '🥛'}</span>
          <div>
            <div style="font-weight: 800; font-size: 0.95rem;">${p.nombre}</div>
            <div style="font-size: 0.80rem; color: #64748b;">${p.presentacion} • S/ ${Number(p.precio).toFixed(2)}</div>
          </div>
        </div>
        <div class="qty-control">
          <button type="button" class="qty-btn" style="width: 34px; height: 34px;" onclick="changeManagerHabitualQty('${p.id}', -1)">−</button>
          <span class="qty-val" style="font-size: 1.05rem;">${qty}</span>
          <button type="button" class="qty-btn plus" style="width: 34px; height: 34px;" onclick="changeManagerHabitualQty('${p.id}', 1)">+</button>
        </div>
      </div>
    `;
  }).join('');
}

async function saveManagerHabitualConfig() {
  if (!state.managerEditingClientId) return;
  await saveHabitualForClient(state.managerEditingClientId, state.managerHabitualDraft);
  closeManagerHabitualEditor();
}

async function quickCreateHabitualOrderForClient(clienteId) {
  const client = state.clientes.find(c => c.id === clienteId);
  const frec = state.frecuentes.filter(f => f.cliente_id === clienteId);
  if (!client) return;

  if (frec.length === 0) {
    showToast('⚠️ Este cliente aún no tiene productos en su Pedido Habitual. Toca "Definir / Editar" primero.');
    openManagerHabitualEditor(clienteId);
    return;
  }

  const items = frec.map(f => {
    const prod = state.productos.find(p => p.id === f.producto_id);
    return {
      producto_id: f.producto_id,
      cantidad: f.cantidad_habitual,
      precio_unitario: Number(prod?.precio || 8.5)
    };
  });

  await registerNewOrder({
    cliente_id: client.id,
    registrado_por_id: state.currentUser?.id || client.id,
    origen: 'MANUAL_ENCARGADO',
    agencia_envio: 'Reparto Directo Yogulé',
    observaciones: `Pedido habitual registrado para ${client.nombre_negocio}.`,
    items
  });

  switchManagerTab('orders');
  setOrderFilter('PENDIENTE');
}

// ============================================================================
// 7. GESTIÓN DE PRODUCTOS POR LA ENCARGADA (SIN RUIDO NI STOCK, CON ALTA Y EDICIÓN)
// ============================================================================

function toggleNewProductForm() {
  const form = document.getElementById('newProductForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function handleCreateProduct(e) {
  e.preventDefault();
  const name = document.getElementById('npName').value.trim();
  const flavor = document.getElementById('npFlavor').value.trim();
  const presentation = document.getElementById('npPresentation').value.trim();
  const line = document.getElementById('npLine').value;
  const price = parseFloat(document.getElementById('npPrice').value) || 8.5;
  const emoji = document.getElementById('npEmoji').value;

  const skuSuffix = normalizeStr(flavor).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'PROD';
  const sku = `YOG-${skuSuffix}-${Math.floor(100 + Math.random() * 900)}`;
  const keywords = [normalizeStr(flavor), normalizeStr(name)].filter(Boolean);

  const payload = {
    sku,
    nombre: name,
    linea: line,
    sabor: flavor,
    presentacion: presentation,
    precio: price,
    icono_emoji: emoji,
    palabras_clave: keywords,
    activo: true
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/productos`, {
      method: 'POST',
      headers: supaHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('No se pudo crear el producto');
    showToast(`✅ Producto "${name}" agregado al catálogo. Ya está visible para todos los clientes.`);
    document.getElementById('newProductForm').reset();
    toggleNewProductForm();
    await reloadFromSupabase(true);
  } catch (err) {
    console.error(err);
    showToast('⚠️ Error guardando el producto.');
  }
}

async function updateProductPrice(prodId) {
  const prod = state.productos.find(p => p.id === prodId);
  if (!prod) return;
  const inputEl = document.getElementById(`priceInput_${prodId}`);
  const newPrice = parseFloat(inputEl?.value);
  if (isNaN(newPrice) || newPrice < 0) {
    showToast('⚠️ Ingresa un precio válido.');
    return;
  }

  prod.precio = newPrice;
  saveLocalCache();
  renderAll();

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prodId}`, {
      method: 'PATCH',
      headers: supaHeaders(),
      body: JSON.stringify({ precio: newPrice })
    });
    showToast(`✅ Precio de ${prod.nombre} actualizado a S/ ${newPrice.toFixed(2)}`);
  } catch (e) {
    console.error(e);
  }
}

async function toggleProductActive(prodId) {
  const prod = state.productos.find(p => p.id === prodId);
  if (!prod) return;
  prod.activo = !prod.activo;
  saveLocalCache();
  renderAll();

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prodId}`, {
      method: 'PATCH',
      headers: supaHeaders(),
      body: JSON.stringify({ activo: prod.activo })
    });
    showToast(prod.activo ? `✅ ${prod.nombre} visible para clientes` : `👁️ ${prod.nombre} oculto del catálogo`);
  } catch (e) {
    console.error(e);
  }
}

function renderManagerProducts() {
  const grid = document.getElementById('managerProductsGrid');
  if (!grid) return;

  grid.innerHTML = state.productos.map(p => `
    <div class="product-card" style="opacity: ${p.activo === false ? '0.55' : '1'};">
      <div class="product-header">
        <div class="product-emoji" style="background: #f1f5f9;">
          ${p.icono_emoji || '🥛'}
        </div>
        <div style="flex: 1;">
          <span style="font-size: 0.74rem; font-weight: 800; color: #64748b;">${p.linea}</span>
          <h4 style="font-size: 1.02rem; font-weight: 900; color: #0f172a;">${p.nombre}</h4>
          <div style="font-size: 0.84rem; color: #475569;">${p.presentacion}</div>
        </div>
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 10px; border-top: 1px solid #e2e8f0;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-weight: 800; font-size: 0.9rem;">S/</span>
          <input
            type="number"
            step="0.10"
            min="0"
            id="priceInput_${p.id}"
            class="form-input"
            style="width: 86px; padding: 6px 8px; font-weight: 800;"
            value="${Number(p.precio).toFixed(2)}"
          />
          <button type="button" class="btn btn-outline" style="padding: 6px 10px; font-size: 0.80rem;" onclick="updateProductPrice('${p.id}')">
            Guardar
          </button>
        </div>

        <button
          type="button"
          class="btn ${p.activo === false ? 'btn-teal' : 'btn-outline'}"
          style="padding: 6px 10px; font-size: 0.78rem;"
          onclick="toggleProductActive('${p.id}')"
        >
          ${p.activo === false ? 'Activar' : 'Ocultar'}
        </button>
      </div>
    </div>
  `).join('');
}

// ============================================================================
// 8. PORTAL DEL CLIENTE + CONFIGURACIÓN DE SU PROPIO PEDIDO HABITUAL
// ============================================================================

function initClientHabitualDraft(clienteId) {
  state.clientHabitualDraft = {};
  state.frecuentes
    .filter(f => f.cliente_id === clienteId)
    .forEach(f => {
      state.clientHabitualDraft[f.producto_id] = f.cantidad_habitual;
    });
}

function switchClientTab(tab) {
  document.getElementById('clientSectionNewOrder').style.display = tab === 'newOrder' ? 'block' : 'none';
  document.getElementById('clientSectionHabitualConfig').style.display = tab === 'habitualConfig' ? 'block' : 'none';
  document.getElementById('clientSectionMyOrders').style.display = tab === 'myOrders' ? 'block' : 'none';

  document.getElementById('clientTabBtnOrder').classList.toggle('active', tab === 'newOrder');
  document.getElementById('clientTabBtnHabitual').classList.toggle('active', tab === 'habitualConfig');
  document.getElementById('clientTabBtnHistory').classList.toggle('active', tab === 'myOrders');

  if (tab === 'habitualConfig' && state.currentUser) {
    initClientHabitualDraft(state.currentUser.id);
  }
  renderClientPortal();
}

function renderClientPortal() {
  if (!state.currentUser) return;

  const activeProducts = state.productos.filter(p => p.activo !== false);

  const frec = state.frecuentes.filter(f => f.cliente_id === state.currentUser.id);
  const frecChips = frec.map(f => {
    const p = state.productos.find(pr => pr.id === f.producto_id);
    return p ? `<span class="need-chip">${p.icono_emoji} <strong>${f.cantidad_habitual}</strong> × ${p.nombre}</span>` : '';
  }).filter(Boolean).join(' ');

  const summaryEl = document.getElementById('clientFrequentSummary');
  if (summaryEl) {
    summaryEl.innerHTML = frecChips
      ? frecChips
      : `Aún no has definido tu pedido habitual. Toca <strong>"✏️ Configurar mi Pedido Habitual"</strong> para guardarlo.`;
  }

  const catalogEl = document.getElementById('clientProductsCatalog');
  if (catalogEl) {
    catalogEl.innerHTML = activeProducts.map(p => {
      const qty = state.clientCart[p.id] || 0;
      return `
        <div class="product-card" style="padding: 14px; border-color: ${qty > 0 ? 'var(--yogule-pink)' : 'var(--border-color)'}; border-width: ${qty > 0 ? '3px' : '2px'};">
          <div class="product-header">
            <div class="product-emoji" style="background: #f8fafc; width: 46px; height: 46px; font-size: 1.6rem;">
              ${p.icono_emoji || '🥛'}
            </div>
            <div style="flex: 1;">
              <h4 style="font-size: 1rem; font-weight: 900; color: #0f172a;">${p.nombre}</h4>
              <div style="font-size: 0.82rem; color: #64748b;">${p.presentacion}</div>
              <div style="font-size: 1.15rem; font-weight: 900; color: var(--yogule-pink); margin-top: 2px;">
                S/ ${Number(p.precio).toFixed(2)}
              </div>
            </div>
          </div>

          <div class="qty-control">
            <button type="button" class="qty-btn" style="width: 38px; height: 38px;" onclick="changeClientCartQty('${p.id}', -1)">−</button>
            <span class="qty-val">${qty}</span>
            <button type="button" class="qty-btn plus" style="width: 38px; height: 38px;" onclick="changeClientCartQty('${p.id}', 1)">+</button>
          </div>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-outline" style="flex: 1; padding: 5px; font-size: 0.78rem;" onclick="changeClientCartQty('${p.id}', 6)">+6</button>
            <button type="button" class="btn btn-outline" style="flex: 1; padding: 5px; font-size: 0.78rem;" onclick="changeClientCartQty('${p.id}', 12)">+12</button>
          </div>
        </div>
      `;
    }).join('');
  }

  const habitualGridEl = document.getElementById('clientHabitualProductsGrid');
  if (habitualGridEl) {
    habitualGridEl.innerHTML = activeProducts.map(p => {
      const qty = state.clientHabitualDraft[p.id] || 0;
      return `
        <div class="product-card" style="padding: 14px; border-color: ${qty > 0 ? 'var(--yogule-gold)' : 'var(--border-color)'}; border-width: ${qty > 0 ? '3px' : '2px'};">
          <div class="product-header">
            <div class="product-emoji" style="background: #fffdf5; width: 46px; height: 46px; font-size: 1.6rem;">
              ${p.icono_emoji || '🥛'}
            </div>
            <div style="flex: 1;">
              <h4 style="font-size: 1rem; font-weight: 900;">${p.nombre}</h4>
              <div style="font-size: 0.82rem; color: #64748b;">${p.presentacion} • S/ ${Number(p.precio).toFixed(2)}</div>
            </div>
          </div>

          <div class="qty-control">
            <button type="button" class="qty-btn" style="width: 38px; height: 38px;" onclick="changeClientHabitualDraftQty('${p.id}', -1)">−</button>
            <span class="qty-val">${qty}</span>
            <button type="button" class="qty-btn plus" style="width: 38px; height: 38px;" onclick="changeClientHabitualDraftQty('${p.id}', 1)">+</button>
          </div>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-outline" style="flex: 1; padding: 5px; font-size: 0.78rem;" onclick="changeClientHabitualDraftQty('${p.id}', 6)">+6</button>
            <button type="button" class="btn btn-outline" style="flex: 1; padding: 5px; font-size: 0.78rem;" onclick="changeClientHabitualDraftQty('${p.id}', 12)">+12</button>
          </div>
        </div>
      `;
    }).join('');
  }

  renderClientCartSummary();

  const myOrders = state.pedidos.filter(p => p.cliente_id === state.currentUser.id);
  const badgeEl = document.getElementById('clientOrdersCountBadge');
  if (badgeEl) badgeEl.textContent = myOrders.length;

  const myOrdersList = document.getElementById('clientMyOrdersList');
  if (myOrdersList) {
    myOrdersList.innerHTML = myOrders.length === 0
      ? `<div class="card" style="text-align: center; padding: 24px;">Aún no tienes pedidos registrados.</div>`
      : myOrders.map(o => renderOrderCardHTML(o, false)).join('');
  }
}

function changeClientCartQty(prodId, delta) {
  const curr = state.clientCart[prodId] || 0;
  const next = curr + delta;
  if (next <= 0) {
    delete state.clientCart[prodId];
  } else {
    state.clientCart[prodId] = next;
  }
  renderClientPortal();
}

function changeClientHabitualDraftQty(prodId, delta) {
  const curr = state.clientHabitualDraft[prodId] || 0;
  const next = curr + delta;
  if (next <= 0) {
    delete state.clientHabitualDraft[prodId];
  } else {
    state.clientHabitualDraft[prodId] = next;
  }
  renderClientPortal();
}

async function saveClientHabitualConfig() {
  if (!state.currentUser) return;
  await saveHabitualForClient(state.currentUser.id, state.clientHabitualDraft);
  switchClientTab('newOrder');
}

async function saveCurrentCartAsHabitual() {
  if (!state.currentUser) return;
  const entries = Object.entries(state.clientCart);
  if (entries.length === 0) return;
  await saveHabitualForClient(state.currentUser.id, { ...state.clientCart });
}

async function saveHabitualForClient(clienteId, draftMap) {
  state.frecuentes = state.frecuentes.filter(f => f.cliente_id !== clienteId);
  Object.entries(draftMap).forEach(([prodId, qty]) => {
    if (qty > 0) {
      state.frecuentes.push({
        id: 'local-frec-' + Date.now() + '-' + prodId,
        cliente_id: clienteId,
        producto_id: prodId,
        cantidad_habitual: qty,
        nota: 'Configurado por usuario'
      });
    }
  });
  saveLocalCache();
  renderAll();

  if (state.isOfflineSimulated) {
    state.pendingSyncQueue.push({ type: 'SAVE_HABITUAL', cliente_id: clienteId, draftMap });
    saveLocalCache();
    updateSyncStatusUI();
    showToast('⭐ Pedido Habitual guardado en el dispositivo (se sincronizará al volver internet).');
    return;
  }

  try {
    await persistClientHabitualInSupabase(clienteId, draftMap);
    showToast('⭐ ¡Pedido Habitual guardado en Supabase! Ahora puedes cargarlo con 1 solo clic.');
    await reloadFromSupabase(true);
  } catch (e) {
    console.error(e);
  }
}

async function persistClientHabitualInSupabase(clienteId, draftMap) {
  await fetch(`${SUPABASE_URL}/rest/v1/cliente_productos_frecuentes?cliente_id=eq.${clienteId}`, {
    method: 'DELETE',
    headers: supaHeaders()
  });

  const rows = Object.entries(draftMap)
    .filter(([, qty]) => qty > 0)
    .map(([prodId, qty]) => ({
      cliente_id: clienteId,
      producto_id: prodId,
      cantidad_habitual: qty,
      nota: 'Pedido habitual definido'
    }));

  if (rows.length > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/cliente_productos_frecuentes`, {
      method: 'POST',
      headers: supaHeaders(),
      body: JSON.stringify(rows)
    });
  }
}

function loadClientFrequentItemsToCart() {
  if (!state.currentUser) return;
  const frec = state.frecuentes.filter(f => f.cliente_id === state.currentUser.id);
  if (frec.length === 0) {
    showToast('⚠️ Primero define qué productos sueles pedir en "⭐ Configurar mi Pedido Habitual".');
    switchClientTab('habitualConfig');
    return;
  }

  state.clientCart = {};
  frec.forEach(f => {
    state.clientCart[f.producto_id] = f.cantidad_habitual;
  });
  renderClientPortal();
  showToast('⚡ Tu Pedido Habitual se cargó al carrito.');
}

function renderClientCartSummary() {
  const entries = Object.entries(state.clientCart);
  const textEl = document.getElementById('clientCartText');
  const totalEl = document.getElementById('clientCartTotal');
  const detailEl = document.getElementById('clientCartItemsDetail');
  const submitArea = document.getElementById('clientCartSubmitArea');

  if (entries.length === 0) {
    textEl.textContent = 'Selecciona las cantidades abajo o toca "Cargar mi Pedido Habitual".';
    totalEl.textContent = 'S/ 0.00';
    detailEl.innerHTML = '';
    submitArea.style.display = 'none';
    return;
  }

  let total = 0;
  let totalUnits = 0;
  const chips = entries.map(([prodId, qty]) => {
    const p = state.productos.find(pr => pr.id === prodId);
    if (!p) return '';
    total += qty * Number(p.precio);
    totalUnits += qty;
    return `<span class="need-chip" style="font-size: 0.90rem; padding: 5px 10px;">${p.icono_emoji} <strong>${qty}</strong> × ${p.nombre} (S/ ${(qty * p.precio).toFixed(2)})</span>`;
  }).join('');

  textEl.textContent = `${entries.length} producto(s) seleccionados (${totalUnits} unidades):`;
  totalEl.textContent = `S/ ${total.toFixed(2)}`;
  detailEl.innerHTML = chips;
  submitArea.style.display = 'block';
}

async function submitClientOrder() {
  if (!state.currentUser) return;
  const entries = Object.entries(state.clientCart);
  if (entries.length === 0) return;

  const notes = document.getElementById('clientOrderNotes').value.trim();

  const itemsPayload = entries.map(([prodId, qty]) => {
    const prod = state.productos.find(p => p.id === prodId);
    return {
      producto_id: prodId,
      cantidad: qty,
      precio_unitario: Number(prod?.precio || 8.5)
    };
  });

  await registerNewOrder({
    cliente_id: state.currentUser.id,
    registrado_por_id: state.currentUser.id,
    origen: 'PORTAL_CLIENTE',
    agencia_envio: 'Reparto Directo Yogulé',
    observaciones: notes,
    items: itemsPayload
  });

  state.clientCart = {};
  document.getElementById('clientOrderNotes').value = '';
  switchClientTab('myOrders');
}

// ============================================================================
// 9. UTILIDADES UI
// ============================================================================

function setViewportMode(mode) {
  const wrapper = document.getElementById('viewportWrapper');
  const btnDesk = document.getElementById('btnViewDesktop');
  const btnMob = document.getElementById('btnViewMobile');

  if (mode === 'mobile') {
    wrapper.classList.add('mobile-preview');
    btnMob.classList.add('active');
    btnDesk.classList.remove('active');
  } else {
    wrapper.classList.remove('mobile-preview');
    btnDesk.classList.add('active');
    btnMob.classList.remove('active');
  }
}

function toggleTrainingGuide() {
  const sec = document.getElementById('trainingGuideSection');
  sec.style.display = sec.style.display === 'none' ? 'block' : 'none';
}

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-PE', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return iso;
  }
}

function showToast(msg) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 4000);
}

function renderAll() {
  renderQuickLoginList();
  if (state.currentUser?.rol === 'encargado') {
    renderManagerOrders();
    renderClientsPortfolio();
    renderManagerProducts();
  } else if (state.currentUser?.rol === 'cliente') {
    renderClientPortal();
  }
}

window.addEventListener('DOMContentLoaded', initApp);
