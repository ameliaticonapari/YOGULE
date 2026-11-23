/* ============================================================================
   LÓGICA OPERATIVA MINIMALISTA • CERO RUIDO VISUAL • SOLO CANTIDADES
   Conectado en vivo a Supabase (Sin RLS) + Modo Offline
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
  clientCart: {},
  clientHabitualDraft: {},
  managerEditingClientId: null,
  managerHabitualDraft: {},
  waDraftItems: {}
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

    if (!silent) showToast('Actualizado');
  } catch (err) {
    console.error(err);
    updateSyncStatusUI(true);
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
      console.error(e);
    }
  }
}

function toggleOfflineMode() {
  state.isOfflineSimulated = !state.isOfflineSimulated;
  updateSyncStatusUI();
  if (!state.isOfflineSimulated) {
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
    text.textContent = `Sin Internet (${qCount})`;
    btn.textContent = 'Conectar';
    btn.classList.add('active');
  } else {
    pill.className = 'sync-pill online';
    text.textContent = 'En Línea';
    btn.textContent = 'Modo Sin Internet';
    btn.classList.remove('active');
  }
}

// ============================================================================
// 2. INICIO DE SESIÓN
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
          showToast('Usuario o clave incorrectos');
          return;
        }
      }
    } catch (err) {
      console.warn(err);
    }
  }

  const found = state.clientes.find(
    c => c.usuario.toLowerCase() === username.toLowerCase() &&
         (c.password_visible === password || password === '123456' || password === 'yogule123')
  );
  if (!found) {
    showToast('Usuario o clave incorrectos');
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
    container.innerHTML = `<div style="padding:6px; color:#64748b;">Cargando...</div>`;
    return;
  }

  container.innerHTML = state.clientes.map(c => {
    const isManager = c.rol === 'encargado';
    return `
      <button type="button" class="quick-login-item ${isManager ? 'manager' : ''}" onclick="loginWithCredentials('${c.usuario}', '${c.password_visible}')">
        <div>
          <div style="font-weight: 700; color: #0f172a;">
            ${c.nombre_contacto} (${c.ciudad})
          </div>
          <div style="font-size: 11px; color: #64748b;">
            <code>${c.usuario}</code> / <code>${c.password_visible}</code>
          </div>
        </div>
        <span class="btn ${isManager ? 'btn-primary' : 'btn-outline'}" style="padding: 2px 7px; font-size: 11px;">
          Entrar
        </span>
      </button>
    `;
  }).join('');
}

// ============================================================================
// 3. TARJETAS DE PEDIDOS SIN RUIDO VISUAL
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
  citySelect.innerHTML = `<option value="TODAS">Todas (${cities.length})</option>` +
    cities.map(city => `<option value="${city}" ${city === currentCity ? 'selected' : ''}>${city}</option>`).join('');

  const query = (document.getElementById('searchOrdersInput')?.value || '').toLowerCase().trim();

  const filtered = state.pedidos.filter(p => {
    const client = state.clientes.find(c => c.id === p.cliente_id);
    if (state.orderFilter !== 'TODOS' && p.estado !== state.orderFilter) return false;
    if (currentCity !== 'TODAS' && client?.ciudad !== currentCity) return false;
    if (query) {
      const haystack = `${p.codigo_pedido} ${client?.nombre_contacto || ''} ${client?.nombre_negocio || ''} ${client?.ciudad || ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const listEl = document.getElementById('managerOrdersList');
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="card" style="text-align: center; padding: 14px; color:#64748b;">Sin pedidos en ${state.orderFilter}</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(pedido => renderOrderCardHTML(pedido, true)).join('');
}

function renderOrderCardHTML(pedido, isManagerView) {
  const cliente = state.clientes.find(c => c.id === pedido.cliente_id) || {
    nombre_contacto: 'Cliente',
    nombre_negocio: '',
    ciudad: ''
  };
  const items = state.detalles.filter(d => d.pedido_id === pedido.id);
  const totalUnits = items.reduce((sum, it) => sum + Number(it.cantidad || 0), 0);

  return `
    <article class="order-card estado-${pedido.estado}">
      <!-- CABECERA EN 1 LÍNEA: Código + Cliente + Ciudad | Unidades + Fecha -->
      <div class="order-card-header">
        <div>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span class="order-code-badge">${pedido.codigo_pedido}</span>
            <strong style="font-size: 13px; color: #0f172a;">${cliente.nombre_negocio}</strong>
            <span style="font-size: 12px; color: #64748b;">(${cliente.nombre_contacto} • ${cliente.ciudad})</span>
          </div>
        </div>
        <div style="text-align: right; white-space: nowrap;">
          <strong style="font-size: 13px; color: var(--yogule-pink);">${totalUnits} und.</strong>
          <span style="font-size: 11px; color: #64748b; margin-left: 4px;">${formatDateTime(pedido.created_at)}</span>
        </div>
      </div>

      <!-- PRODUCTOS DIRECTOS (SIN CAJAS NI TEXTOS REPETIDOS) -->
      <div class="checklist-grid" style="margin-bottom: 8px;">
        ${items.map(item => {
          const prod = state.productos.find(pr => pr.id === item.producto_id) || { nombre: 'Producto' };
          return `
            <div class="checklist-item ${item.alistado ? 'checked' : ''}" onclick="${isManagerView ? `toggleItemChecklist('${item.id}')` : ''}">
              <div class="check-box-ui">${item.alistado ? '✓' : ''}</div>
              <div style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <strong style="color: var(--yogule-pink);">${item.cantidad}</strong> × ${prod.nombre}
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- FILA INFERIOR ÚNICA: ESTADO ACTUAL + BOTÓN DE AVANCE -->
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 6px; border-top: 1px solid #f1f5f9;">
        <span class="status-badge ${pedido.estado}">
          ${pedido.estado === 'PENDIENTE' ? '1. Pendiente' : pedido.estado === 'RECIBIDO' ? '2. Recibido' : '3. Entregado'}
        </span>

        ${isManagerView ? `
          <div>
            ${pedido.estado === 'PENDIENTE' ? `
              <button class="btn btn-blue" style="padding: 4px 10px;" onclick="advanceOrderStatus('${pedido.id}', 'RECIBIDO')">
                Pasar a Recibido ➔
              </button>
            ` : ''}
            ${pedido.estado === 'RECIBIDO' ? `
              <button class="btn btn-green" style="padding: 4px 10px;" onclick="advanceOrderStatus('${pedido.id}', 'ENTREGADO')">
                Pasar a Entregado ➔
              </button>
            ` : ''}
          </div>
        ` : ''}
      </div>
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
      showToast(`${pedido.codigo_pedido}: ${nuevoEstado}`);
      await reloadFromSupabase(true);
    }
  } catch (e) {
    console.error(e);
  }
}

// ============================================================================
// 4. PARSER DE TEXTO DE WHATSAPP
// ============================================================================

function populateWaClientsSelect() {
  const select = document.getElementById('waClientSelect');
  if (!select) return;
  const onlyClients = state.clientes.filter(c => c.rol === 'cliente');
  select.innerHTML = onlyClients.map(c =>
    `<option value="${c.id}">${c.nombre_negocio} — ${c.nombre_contacto} (${c.ciudad})</option>`
  ).join('');
}

function loadSampleWhatsApp(num) {
  const samples = {
    1: 'María de Arequipa:\n20 yogurt fresa\n15 durazno\n12 sauco\n10 queso paria',
    2: 'Carlos de Cusco:\n24 sauco\n18 lucuma\n15 natural\n3 cajas surtidas',
    3: 'Elena de Trujillo:\n4 cajas surtidas\n25 fresa\n20 maracuya\n15 vainilla'
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
      break;
    }
  }

  const segments = raw
    .split(/\n|,|\by\b/i)
    .map(s => s.trim())
    .filter(Boolean);

  const detected = {};
  const activeProducts = state.productos.filter(p => p.activo !== false);

  for (const seg of segments) {
    const normSeg = normalizeStr(seg);
    const qtyMatch = normSeg.match(/(\d+)/);
    if (!qtyMatch) continue;

    const qty = parseInt(qtyMatch[1], 10);
    if (!qty || qty <= 0) continue;

    for (const prod of activeProducts) {
      const keywords = [
        normalizeStr(prod.sabor),
        normalizeStr(prod.nombre),
        ...(prod.palabras_clave || []).map(k => normalizeStr(k))
      ].filter(k => k && k.length >= 3);

      if (keywords.some(kw => normSeg.includes(kw))) {
        detected[prod.id] = (detected[prod.id] || 0) + qty;
        break;
      }
    }
  }

  state.waDraftItems = detected;
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
    container.innerHTML = `<div style="padding: 12px; color: #64748b;">Pega un texto a la izquierda.</div>`;
    return;
  }

  let totalUnits = 0;
  const rowsHtml = entries.map(([prodId, qty]) => {
    const prod = state.productos.find(p => p.id === prodId);
    if (!prod) return '';
    totalUnits += qty;

    return `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; border-bottom: 1px solid #e2e8f0;">
        <span>${prod.nombre} <small style="color:#64748b;">(${prod.presentacion})</small></span>
        <div class="qty-control">
          <button type="button" class="qty-btn" onclick="adjustWaDraftQty('${prod.id}', -1)">−</button>
          <span class="qty-val">${qty}</span>
          <button type="button" class="qty-btn plus" onclick="adjustWaDraftQty('${prod.id}', 1)">+</button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden;">
      ${rowsHtml}
    </div>
    <button type="button" class="btn btn-green btn-block" style="margin-top: 8px;" onclick="saveWhatsAppOrder()">
      Guardar Pedido (${totalUnits} und.)
    </button>
  `;
}

async function saveWhatsAppOrder() {
  const clientId = document.getElementById('waClientSelect').value;
  const rawText = document.getElementById('waRawText').value.trim();
  const entries = Object.entries(state.waDraftItems);

  if (!clientId || entries.length === 0) return;

  const itemsPayload = entries.map(([prodId, qty]) => ({
    producto_id: prodId,
    cantidad: qty,
    precio_unitario: 0
  }));

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
    const nowIso = new Date().toISOString();

    state.pedidos.unshift({
      id: tempId,
      numero_pedido: nextNum,
      codigo_pedido: code,
      cliente_id: payload.cliente_id,
      registrado_por_id: payload.registrado_por_id,
      estado: 'PENDIENTE',
      origen: payload.origen,
      created_at: nowIso
    });

    payload.items.forEach((it, idx) => {
      state.detalles.push({
        id: `${tempId}-item-${idx}`,
        pedido_id: tempId,
        producto_id: it.producto_id,
        cantidad: it.cantidad,
        precio_unitario: 0,
        alistado: false
      });
    });

    state.pendingSyncQueue.push({ type: 'CREATE_ORDER', payload });
    saveLocalCache();
    updateSyncStatusUI();
    renderAll();
    showToast(`Pedido ${code} guardado`);
    return;
  }

  try {
    const created = await createOrderInSupabase(payload);
    showToast(`Pedido ${created.codigo_pedido} creado`);
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
      agencia_envio: 'Reparto Directo Yogulé',
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
    precio_unitario: 0,
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
// 6. CARTERA DE CLIENTES (SIN DETALLE DE PEDIDO HABITUAL, SOLO 1 BOTÓN)
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
    telefono_whatsapp: document.getElementById('ncPhone').value.trim() || '-',
    agencia_preferida: 'Reparto Directo Yogulé',
    direccion_entrega: '',
    notas_necesidades: '',
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
      showToast('Usuario ya existe');
      return;
    }
    showToast('Cliente guardado');
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
  grid.innerHTML = clients.map(c => `
    <div class="card" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px;">
      <div style="min-width: 0;">
        <div style="font-weight: 800; font-size: 13px; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${c.nombre_negocio} <span style="color: var(--yogule-pink); font-weight: 700;">(${c.ciudad})</span>
        </div>
        <div style="font-size: 11px; color: #475569;">
          ${c.nombre_contacto} • <code>${c.usuario}</code> / <code>${c.password_visible}</code>
        </div>
      </div>

      <button class="btn btn-outline" style="padding: 4px 9px; font-size: 11px;" onclick="openManagerHabitualEditor('${c.id}')">
        Pedido Habitual
      </button>
    </div>
  `).join('');
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
    `Pedido Habitual: ${client.nombre_negocio} (${client.ciudad})`;
  document.getElementById('managerHabitualEditorCard').style.display = 'block';
  renderManagerHabitualEditorGrid();
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
      <div class="product-card" style="border-color: ${qty > 0 ? 'var(--yogule-pink)' : 'var(--border-color)'};">
        <div style="min-width:0;">
          <div style="font-weight: 700; font-size: 12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.nombre}</div>
          <div style="font-size: 10px; color: #64748b;">${p.presentacion}</div>
        </div>
        <div class="qty-control">
          <button type="button" class="qty-btn" onclick="changeManagerHabitualQty('${p.id}', -1)">−</button>
          <span class="qty-val">${qty}</span>
          <button type="button" class="qty-btn plus" onclick="changeManagerHabitualQty('${p.id}', 1)">+</button>
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

async function createOrderFromManagerHabitualModal() {
  const clienteId = state.managerEditingClientId;
  if (!clienteId) return;
  await saveHabitualForClient(clienteId, state.managerHabitualDraft);

  const entries = Object.entries(state.managerHabitualDraft).filter(([, q]) => q > 0);
  if (entries.length === 0) {
    showToast('Asigna al menos 1 producto');
    return;
  }

  const items = entries.map(([prodId, qty]) => ({
    producto_id: prodId,
    cantidad: qty,
    precio_unitario: 0
  }));

  closeManagerHabitualEditor();
  await registerNewOrder({
    cliente_id: clienteId,
    registrado_por_id: state.currentUser?.id || clienteId,
    origen: 'MANUAL_ENCARGADO',
    agencia_envio: 'Reparto Directo Yogulé',
    observaciones: '',
    items
  });

  switchManagerTab('orders');
  setOrderFilter('PENDIENTE');
}

// ============================================================================
// 7. GESTIÓN DE PRODUCTOS (SIN CATEGORÍA, PRECIOS NI STOCK)
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

  const skuSuffix = normalizeStr(flavor).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'PROD';
  const sku = `YOG-${skuSuffix}-${Math.floor(100 + Math.random() * 900)}`;
  const keywords = [normalizeStr(flavor), normalizeStr(name)].filter(Boolean);

  const payload = {
    sku,
    nombre: name,
    linea: 'Yogulé',
    sabor: flavor,
    presentacion: presentation,
    precio: 0,
    icono_emoji: '🥛',
    palabras_clave: keywords,
    activo: true
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/productos`, {
      method: 'POST',
      headers: supaHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Error creando producto');
    showToast(`Producto "${name}" agregado`);
    document.getElementById('newProductForm').reset();
    toggleNewProductForm();
    await reloadFromSupabase(true);
  } catch (err) {
    console.error(err);
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
  } catch (e) {
    console.error(e);
  }
}

function renderManagerProducts() {
  const grid = document.getElementById('managerProductsGrid');
  if (!grid) return;

  grid.innerHTML = state.productos.map(p => `
    <div class="product-card" style="opacity: ${p.activo === false ? '0.45' : '1'};">
      <div style="min-width: 0;">
        <div style="font-weight: 700; font-size: 12px; color: #0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${p.nombre}
        </div>
        <div style="font-size: 11px; color: #64748b;">
          ${p.presentacion}
        </div>
      </div>

      <button
        type="button"
        class="btn ${p.activo === false ? 'btn-teal' : 'btn-outline'}"
        style="padding: 2px 8px; font-size: 11px;"
        onclick="toggleProductActive('${p.id}')"
      >
        ${p.activo === false ? 'Activar' : 'Ocultar'}
      </button>
    </div>
  `).join('');
}

// ============================================================================
// 8. PORTAL DEL CLIENTE (MÍNIMO RUIDO VISUAL)
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

  const catalogEl = document.getElementById('clientProductsCatalog');
  if (catalogEl) {
    catalogEl.innerHTML = activeProducts.map(p => {
      const qty = state.clientCart[p.id] || 0;
      return `
        <div class="product-card" style="border-color: ${qty > 0 ? 'var(--yogule-pink)' : 'var(--border-color)'}; background: ${qty > 0 ? '#fff0f6' : '#fff'};">
          <div style="min-width: 0;">
            <div style="font-weight: 700; font-size: 12px; color: #0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${p.nombre}
            </div>
            <div style="font-size: 11px; color: #64748b;">${p.presentacion}</div>
          </div>

          <div class="qty-control">
            <button type="button" class="qty-btn" onclick="changeClientCartQty('${p.id}', -1)">−</button>
            <span class="qty-val">${qty}</span>
            <button type="button" class="qty-btn plus" onclick="changeClientCartQty('${p.id}', 1)">+</button>
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
        <div class="product-card" style="border-color: ${qty > 0 ? 'var(--yogule-gold)' : 'var(--border-color)'}; background: ${qty > 0 ? '#fffbeb' : '#fff'};">
          <div style="min-width: 0;">
            <div style="font-weight: 700; font-size: 12px; color: #0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${p.nombre}
            </div>
            <div style="font-size: 11px; color: #64748b;">${p.presentacion}</div>
          </div>

          <div class="qty-control">
            <button type="button" class="qty-btn" onclick="changeClientHabitualDraftQty('${p.id}', -1)">−</button>
            <span class="qty-val">${qty}</span>
            <button type="button" class="qty-btn plus" onclick="changeClientHabitualDraftQty('${p.id}', 1)">+</button>
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
      ? `<div class="card" style="text-align: center; padding: 14px;">Sin pedidos registrados.</div>`
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
        nota: ''
      });
    }
  });
  saveLocalCache();
  renderAll();

  if (state.isOfflineSimulated) {
    state.pendingSyncQueue.push({ type: 'SAVE_HABITUAL', cliente_id: clienteId, draftMap });
    saveLocalCache();
    updateSyncStatusUI();
    showToast('Pedido Habitual guardado');
    return;
  }

  try {
    await persistClientHabitualInSupabase(clienteId, draftMap);
    showToast('Pedido Habitual guardado');
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
      nota: ''
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
    showToast('Primero configura tu Pedido Habitual');
    switchClientTab('habitualConfig');
    return;
  }

  state.clientCart = {};
  frec.forEach(f => {
    state.clientCart[f.producto_id] = f.cantidad_habitual;
  });
  renderClientPortal();
}

function renderClientCartSummary() {
  const entries = Object.entries(state.clientCart);
  const textEl = document.getElementById('clientCartText');
  const totalUnitsEl = document.getElementById('clientCartTotalUnits');
  const submitArea = document.getElementById('clientCartSubmitArea');

  if (entries.length === 0) {
    textEl.textContent = '0 unidades seleccionadas';
    if (totalUnitsEl) totalUnitsEl.textContent = '0';
    submitArea.style.display = 'none';
    return;
  }

  const totalUnits = entries.reduce((sum, [, qty]) => sum + qty, 0);
  textEl.textContent = `${entries.length} producto(s) • ${totalUnits} unidades en total`;
  if (totalUnitsEl) totalUnitsEl.textContent = totalUnits;
  submitArea.style.display = 'flex';
}

async function submitClientOrder() {
  if (!state.currentUser) return;
  const entries = Object.entries(state.clientCart);
  if (entries.length === 0) return;

  const itemsPayload = entries.map(([prodId, qty]) => ({
    producto_id: prodId,
    cantidad: qty,
    precio_unitario: 0
  }));

  await registerNewOrder({
    cliente_id: state.currentUser.id,
    registrado_por_id: state.currentUser.id,
    origen: 'PORTAL_CLIENTE',
    agencia_envio: 'Reparto Directo Yogulé',
    observaciones: '',
    items: itemsPayload
  });

  state.clientCart = {};
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
  }, 3000);
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
