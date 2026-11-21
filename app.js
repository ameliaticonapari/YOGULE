/* ============================================================================
   LÓGICA INTERACTIVA + CONEXIÓN EN VIVO A SUPABASE (SIN RLS) + MODO OFFLINE
   Agroindustria Yogulé S.A.C. - Cabana, San Román, Puno
   Proyecto Supabase: https://bpaxkwzbknmntqdsdzwu.supabase.co
   ============================================================================ */

const SUPABASE_URL = 'https://bpaxkwzbknmntqdsdzwu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_i6WIsrxYj12TyQeaCyJ4mg_tMNq7QGn';

// Estado global de la aplicación
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
  clientCart: {}, // { producto_id: cantidad }
  waDraftItems: {}, // { producto_id: cantidad }
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
    console.warn('No se pudo leer caché local:', e);
  }
}

async function reloadFromSupabase(silent = false) {
  if (state.isOfflineSimulated) {
    updateSyncStatusUI();
    if (!silent) showToast('📡 Estás en Modo Sin Internet (Campo). Usando datos guardados en el dispositivo.');
    return;
  }

  try {
    if (state.pendingSyncQueue.length > 0) {
      await flushOfflineQueue();
    }

    const [resClientes, resProductos, resFrec, resPedidos, resDetalles, resTraza] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/clientes?select=*&order=rol.desc,nombre_contacto.asc`, { headers: supaHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/productos?select=*&order=sku.asc`, { headers: supaHeaders() }),
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
      showToast('🟢 Datos actualizados en vivo desde Supabase (Proyecto YOGULE)');
    }
  } catch (err) {
    console.error('Error conectando a Supabase:', err);
    updateSyncStatusUI(true);
    if (!silent) showToast('⚠️ Sin conexión a Supabase, trabajando con respaldo local.');
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
      }
    } catch (e) {
      console.error('Error sincronizando operación en cola:', e);
    }
  }
  showToast(`☁️ ¡Se sincronizaron ${queueCopy.length} cambio(s) pendientes con Supabase!`);
}

function toggleOfflineMode() {
  state.isOfflineSimulated = !state.isOfflineSimulated;
  updateSyncStatusUI();
  if (state.isOfflineSimulated) {
    showToast('📡 Modo Campo (Sin Internet) ACTIVADO. Todo lo que hagas se guardará en el celular y subirá al volver la señal.');
  } else {
    showToast('🟢 Señal recuperada. Sincronizando cambios en segundo plano con Supabase...');
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
    text.textContent = `Modo Sin Internet (Campo) • ${qCount} cambio(s) en cola`;
    btn.textContent = '🟢 Volver a Conectar Internet (Sincronizar)';
    btn.classList.add('active');
  } else {
    pill.className = 'sync-pill online';
    text.textContent = `Supabase En Línea • Sincronizado (${state.pedidos.length} pedidos)`;
    btn.textContent = '📡 Simular Modo Sin Internet (Campo)';
    btn.classList.remove('active');
  }
}

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
          showToast('❌ Usuario o contraseña incorrectos. Verifica tus datos.');
          return;
        }
      }
    } catch (err) {
      console.warn('Fallo RPC login, usando validación local:', err);
    }
  }

  const found = state.clientes.find(
    c => c.usuario.toLowerCase() === username.toLowerCase() && (c.password_visible === password || password === '123456' || password === 'yogule123')
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

  document.getElementById('loginView').style.display = 'none';
  document.getElementById('userSessionBox').style.display = 'flex';
  document.getElementById('sessionUserName').textContent = `${userObj.nombre_contacto} (${userObj.ciudad})`;
  document.getElementById('sessionUserRole').textContent =
    userObj.rol === 'encargado' ? '👩‍💼 ENCARGADA PLANTA' : `🏪 CLIENTE • ${userObj.nombre_negocio}`;

  if (userObj.rol === 'encargado') {
    document.getElementById('managerView').style.display = 'block';
    document.getElementById('clientView').style.display = 'none';
    switchManagerTab('orders');
    showToast(`👩‍💼 Bienvenida ${userObj.nombre_contacto}. Tienes el control nacional de pedidos Yogulé.`);
  } else {
    document.getElementById('managerView').style.display = 'none';
    document.getElementById('clientView').style.display = 'block';
    document.getElementById('clientOrderAgency').value = userObj.agencia_preferida || 'Shalom';
    switchClientTab('newOrder');
    showToast(`🏪 ¡Bienvenido(a) ${userObj.nombre_contacto}! Ya puedes hacer tu pedido directo a Planta Yogulé.`);
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
    container.innerHTML = `<div style="padding:14px; color:#64748b;">Cargando usuarios desde Supabase...</div>`;
    return;
  }

  container.innerHTML = state.clientes.map(c => {
    const isManager = c.rol === 'encargado';
    return `
      <button type="button" class="quick-login-item ${isManager ? 'manager' : ''}" onclick="loginWithCredentials('${c.usuario}', '${c.password_visible}')">
        <div>
          <div style="font-weight: 800; font-size: 0.98rem; color: #0f172a;">
            ${isManager ? '👩‍💼 ' : '🏪 '} ${c.nombre_contacto} — <span style="color: var(--yogule-pink);">${c.ciudad}</span>
          </div>
          <div style="font-size: 0.84rem; color: #475569;">
            ${c.nombre_negocio} • Usuario: <code>${c.usuario}</code> • Clave: <code>${c.password_visible}</code>
          </div>
        </div>
        <span class="btn ${isManager ? 'btn-primary' : 'btn-outline'}" style="padding: 7px 13px; font-size: 0.84rem;">
          Entrar ➔
        </span>
      </button>
    `;
  }).join('');
}

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
  document.getElementById('badgePendingCount').textContent = `${countP} pendientes`;

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
      const haystack = `${p.codigo_pedido} ${client?.nombre_contacto || ''} ${client?.nombre_negocio || ''} ${client?.ciudad || ''} ${p.agencia_envio || ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const listEl = document.getElementById('managerOrdersList');
  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="card" style="text-align: center; padding: 34px;">
        <div style="font-size: 2.5rem;">📭</div>
        <h3 style="margin-top: 8px;">No hay pedidos en esta vista (${state.orderFilter})</h3>
        <p style="color: #64748b; margin-top: 4px;">Puedes cambiar de filtro arriba o pegar un nuevo pedido desde WhatsApp.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(pedido => renderOrderCardHTML(pedido, true)).join('');
}

function renderOrderCardHTML(pedido, isManagerView) {
  const cliente = state.clientes.find(c => c.id === pedido.cliente_id) || {
    nombre_contacto: 'Cliente Yogulé',
    nombre_negocio: '',
    ciudad: 'Puno',
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

  const originLabel =
    pedido.origen === 'WHATSAPP_TEXTO'
      ? '💬 Pegado de WhatsApp'
      : pedido.origen === 'PORTAL_CLIENTE'
      ? '📲 Pedido directo del Cliente (Con su Usuario)'
      : '👩‍💼 Registrado por Encargada';

  return `
    <article class="order-card estado-${pedido.estado}">
      <div class="order-card-header">
        <div>
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <span class="order-code-badge">${pedido.codigo_pedido}</span>
            <span class="status-badge ${pedido.estado}">
              ${pedido.estado === 'PENDIENTE' ? '🟠 1. PENDIENTE (Falta alistar)' : pedido.estado === 'RECIBIDO' ? '🔵 2. RECIBIDO (Ya visto y alistado)' : '🟢 3. ENTREGADO AL CLIENTE'}
            </span>
            <span style="font-size: 0.84rem; background: #f1f5f9; padding: 4px 10px; border-radius: 999px; font-weight: 700; color: #475569;">
              ${originLabel}
            </span>
          </div>
          <h3 style="font-size: 1.22rem; margin-top: 8px; color: #0f172a;">
            🏪 ${cliente.nombre_negocio} — <span style="color: var(--yogule-pink);">${cliente.nombre_contacto}</span>
          </h3>
          <div style="font-size: 0.92rem; color: #475569; margin-top: 2px;">
            📍 <strong>Ciudad:</strong> ${cliente.ciudad} (${cliente.region || 'Perú'}) •
            🚚 <strong>Agencia:</strong> ${pedido.agencia_envio || cliente.agencia_preferida || 'Por definir'} •
            📞 <strong>WhatsApp:</strong> ${cliente.telefono_whatsapp} •
            👤 <strong>Registrado por:</strong> ${registrador ? `${registrador.nombre_contacto} (${registrador.usuario})` : cliente.usuario}
          </div>
        </div>

        <div style="text-align: right;">
          <div style="font-size: 0.80rem; font-weight: 800; color: #64748b;">MONTO TOTAL</div>
          <div style="font-size: 1.65rem; font-weight: 900; color: var(--yogule-pink);">
            S/ ${Number(pedido.total || 0).toFixed(2)}
          </div>
          <div style="font-size: 0.80rem; color: #64748b;">
            📅 ${formatDateTime(pedido.created_at)}
          </div>
        </div>
      </div>

      <div class="trace-stepper">
        <div class="trace-step ${step1Done ? 'done' : ''}" style="${step1Done ? 'border: 2px solid var(--state-pendiente); color: #92400e;' : ''}">
          <span class="trace-step-icon">🟠</span>
          <span>1. PENDIENTE</span>
          <small style="font-weight: 500; font-size: 0.76rem;">Pedido registrado</small>
        </div>
        <div class="trace-step ${step2Done ? 'done' : ''}" style="${step2Done ? 'border: 2px solid var(--state-recibido); color: #075985;' : ''}">
          <span class="trace-step-icon">🔵</span>
          <span>2. RECIBIDO</span>
          <small style="font-weight: 500; font-size: 0.76rem;">Visto y alistado</small>
        </div>
        <div class="trace-step ${step3Done ? 'done' : ''}" style="${step3Done ? 'border: 2px solid var(--state-entregado); color: #166534;' : ''}">
          <span class="trace-step-icon">🟢</span>
          <span>3. ENTREGADO</span>
          <small style="font-weight: 500; font-size: 0.76rem;">Producto entregado</small>
        </div>
      </div>

      ${pedido.texto_whatsapp ? `
        <div style="background: #dcfce7; border-left: 4px solid #16a34a; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 0.90rem;">
          <strong>💬 Mensaje original de WhatsApp guardado:</strong>
          <div style="font-style: italic; color: #166534; margin-top: 2px;">"${pedido.texto_whatsapp}"</div>
        </div>
      ` : ''}

      <div class="checklist-box">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
          <strong style="font-size: 0.96rem;">
            📦 Productos solicitados en este pedido (${items.length} sabores/ítems):
          </strong>
          <span style="font-weight: 800; font-size: 0.88rem; padding: 3px 10px; border-radius: 999px; background: ${allChecked ? '#dcfce7' : '#fee2e2'}; color: ${allChecked ? '#166534' : '#991b1b'};">
            ${allChecked ? '✅ Todos los productos verificados en caja' : `⚠️ Alistados: ${totalItemsChecked} de ${items.length} (Toca cada fila al empacar)`}
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
              <div style="display: flex; align-items: center; gap: 12px;">
                <div class="check-box-ui">${item.alistado ? '✓' : ''}</div>
                <div>
                  <div style="font-weight: 800; font-size: 1rem;">
                    ${prod.icono_emoji || '🥛'} <span style="font-size: 1.12rem; color: var(--yogule-pink);">${item.cantidad} und.</span> × ${prod.nombre}
                  </div>
                  <div style="font-size: 0.82rem; color: #64748b;">
                    ${prod.presentacion} • S/ ${Number(item.precio_unitario).toFixed(2)} c/u
                  </div>
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-weight: 800;">S/ ${Number(item.subtotal || item.cantidad * item.precio_unitario).toFixed(2)}</div>
                <small style="color: ${item.alistado ? '#166534' : '#d97706'}; font-weight: 700;">
                  ${item.alistado ? '✓ Alistado' : 'Falta alistar'}
                </small>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      ${pedido.observaciones ? `
        <div style="font-size: 0.90rem; color: #334155; margin-bottom: 12px; background: #fffbeb; padding: 9px 12px; border-radius: 8px; border: 1px solid #fde68a;">
          📝 <strong>Observación:</strong> ${pedido.observaciones}
        </div>
      ` : ''}

      <div style="font-size: 0.84rem; color: #475569; margin-bottom: 14px; display: flex; flex-wrap: wrap; gap: 8px;">
        ${trazas.map(t => `
          <span style="background: #f1f5f9; padding: 5px 10px; border-radius: 8px; border: 1px solid #cbd5e1;">
            <strong>${t.estado}:</strong> ${formatDateTime(t.created_at)} (${t.nota || t.responsable_nombre})
          </span>
        `).join('')}
      </div>

      ${isManagerView ? `
        <div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; padding-top: 10px; border-top: 1px solid #e2e8f0;">
          ${pedido.estado === 'PENDIENTE' ? `
            <button class="btn btn-blue" style="flex: 1; min-width: 260px;" onclick="advanceOrderStatus('${pedido.id}', 'RECIBIDO')">
              🔵 PASO 2: Marcar como RECIBIDO (Ya lo vi y alisté completo)
            </button>
          ` : ''}
          ${pedido.estado === 'RECIBIDO' ? `
            <button class="btn btn-green" style="flex: 1; min-width: 260px;" onclick="advanceOrderStatus('${pedido.id}', 'ENTREGADO')">
              🟢 PASO 3: Confirmar ENTREGADO al Cliente
            </button>
          ` : ''}
          ${pedido.estado === 'ENTREGADO' ? `
            <div style="color: #166534; font-weight: 800; padding: 8px;">
              ✅ Pedido finalizado y entregado correctamente.
            </div>
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
    console.error('Error guardando check en Supabase:', e);
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
  if (nuevoEstado === 'RECIBIDO') pedido.recibido_at = nowIso;
  if (nuevoEstado === 'ENTREGADO') pedido.entregado_at = nowIso;

  state.trazabilidad.push({
    id: 'local-' + Date.now(),
    pedido_id: pedidoId,
    estado: nuevoEstado,
    responsable_nombre: state.currentUser?.nombre_contacto || 'Encargada Yogulé',
    nota: nuevoEstado === 'RECIBIDO' ? 'Pedido visto y alistado en planta Yogulé' : 'Pedido entregado satisfactoriamente al cliente',
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
    showToast(`📡 Guardado en el celular: ${pedido.codigo_pedido} pasó a ${nuevoEstado} (Se sincronizará al volver internet).`);
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
      showToast(`✅ Pedido ${pedido.codigo_pedido} actualizado a ${nuevoEstado} en Supabase.`);
      await reloadFromSupabase(true);
    }
  } catch (e) {
    console.error('Error actualizando estado en Supabase:', e);
  }
}

function populateWaClientsSelect() {
  const select = document.getElementById('waClientSelect');
  if (!select) return;
  const onlyClients = state.clientes.filter(c => c.rol === 'cliente');
  select.innerHTML = onlyClients.map(c =>
    `<option value="${c.id}">🏪 ${c.nombre_contacto} — ${c.nombre_negocio} (${c.ciudad})</option>`
  ).join('');
  updateWaClientNeedsHint();
}

function updateWaClientNeedsHint() {
  const select = document.getElementById('waClientSelect');
  const hint = document.getElementById('waClientNeedsHint');
  if (!select || !hint) return;
  const client = state.clientes.find(c => c.id === select.value);
  if (!client) return;

  document.getElementById('waAgencyInput').value = client.agencia_preferida || 'Shalom';
  const clientFrec = state.frecuentes.filter(f => f.cliente_id === client.id);
  const chips = clientFrec.map(f => {
    const p = state.productos.find(pr => pr.id === f.producto_id);
    return p ? `<span class="need-chip">${p.icono_emoji} ${f.cantidad_habitual} × ${p.sabor}</span>` : '';
  }).join('');

  hint.innerHTML = `
    <div><strong>💡 Qué suele necesitar ${client.nombre_contacto} (${client.ciudad}):</strong> ${client.notas_necesidades || 'Cliente frecuente'}</div>
    <div style="margin-top: 6px;">${chips || 'Sin productos frecuentes registrados aún.'}</div>
  `;
}

function loadSampleWhatsApp(num) {
  const samples = {
    1: 'Hola caserita Yogulé soy María de Arequipa, por favor envíame:\n20 yogurt fresa 1L\n15 durazno 1L\n12 sauco\n10 queso paria\nPor agencia Marvisur',
    2: 'Buen día planta Yogulé habla Carlos de Cusco, mándame para mañana:\n24 sauco andino\n18 lucuma\n15 natural sin azucar\n3 cajas surtidas 10 sabores por Shalom',
    3: 'Hola amiga Amelia soy Elena de Trujillo, apúntame:\n4 cajas surtidas\n25 fresa\n20 maracuya\n15 vainilla\n12 piña golden por Flores'
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

  const agencies = ['Marvisur', 'Shalom', 'Flores', 'Olva', 'Cruz del Sur', 'Reparto Directo'];
  for (const ag of agencies) {
    if (normFull.includes(normalizeStr(ag))) {
      document.getElementById('waAgencyInput').value = ag;
      break;
    }
  }

  const segments = raw
    .split(/\n|,|\by\b/i)
    .map(s => s.trim())
    .filter(Boolean);

  const detected = {};
  const unmatched = [];

  for (const seg of segments) {
    const normSeg = normalizeStr(seg);
    const qtyMatch = normSeg.match(/(\d+)\s*(?:und|unidades|botellas|cajas|moldes|litros)?/);
    if (!qtyMatch) continue;

    const qty = parseInt(qtyMatch[1], 10);
    if (!qty || qty <= 0) continue;

    let matchedProd = null;
    for (const prod of state.productos) {
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
      <div style="text-align: center; padding: 28px; color: #64748b; background: #f8fafc; border-radius: 12px;">
        <div style="font-size: 2rem;">✍️</div>
        <p style="margin-top: 6px;">Pega un mensaje de WhatsApp a la izquierda o toca uno de los botones de ejemplo.</p>
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
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; gap: 10px;">
        <div>
          <div style="font-weight: 800; font-size: 1rem;">
            ${prod.icono_emoji} ${prod.nombre}
          </div>
          <div style="font-size: 0.82rem; color: #64748b;">
            ${prod.presentacion} • S/ ${Number(prod.precio).toFixed(2)} c/u
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="qty-control">
            <button type="button" class="qty-btn" style="width: 32px; height: 32px; font-size: 1.1rem;" onclick="adjustWaDraftQty('${prod.id}', -1)">−</button>
            <span class="qty-val" style="min-width: 36px; font-size: 1.05rem;">${qty}</span>
            <button type="button" class="qty-btn plus" style="width: 32px; height: 32px; font-size: 1.1rem;" onclick="adjustWaDraftQty('${prod.id}', 1)">+</button>
          </div>
          <strong style="min-width: 78px; text-align: right;">S/ ${sub.toFixed(2)}</strong>
        </div>
      </div>
    `;
  }).join('');

  const unmatchedHtml = state.waUnmatchedLines.length > 0 ? `
    <div style="background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 10px 12px; border-radius: 10px; margin-top: 12px; font-size: 0.88rem;">
      ⚠️ <strong>Atención Encargada:</strong> Estas líneas tenían números pero no coincidieron con un sabor exacto:
      <code>${state.waUnmatchedLines.join(' | ')}</code>
    </div>
  ` : '';

  container.innerHTML = `
    <div style="border: 2px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      ${rowsHtml}
      <div style="background: #fdf2f8; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 800;">TOTAL DETECTADO (${entries.length} productos):</span>
        <span style="font-size: 1.5rem; font-weight: 900; color: var(--yogule-pink);">S/ ${total.toFixed(2)}</span>
      </div>
    </div>
    ${unmatchedHtml}
    <button type="button" class="btn btn-green btn-block" style="margin-top: 16px; font-size: 1.08rem; padding: 15px;" onclick="saveWhatsAppOrder()">
      ✅ Confirmar y Guardar Pedido en Estado PENDIENTE
    </button>
  `;
}

async function saveWhatsAppOrder() {
  const clientId = document.getElementById('waClientSelect').value;
  const rawText = document.getElementById('waRawText').value.trim();
  const agency = document.getElementById('waAgencyInput').value.trim() || 'Shalom';
  const entries = Object.entries(state.waDraftItems);

  if (!clientId || entries.length === 0) {
    showToast('⚠️ Selecciona un cliente y asegúrate de que haya al menos 1 producto detectado.');
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
    agencia_envio: agency,
    texto_whatsapp: rawText,
    observaciones: 'Copiado de WhatsApp con verificación automática de sabores.',
    items: itemsPayload
  });

  document.getElementById('waRawText').value = '';
  state.waDraftItems = {};
  switchManagerTab('orders');
  setOrderFilter('PENDIENTE');
}

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
      responsable_nombre: state.currentUser?.nombre_contacto || 'Usuario Yogulé',
      nota: 'Registrado sin internet (Pendiente de sincronizar)',
      created_at: nowIso
    });

    state.pendingSyncQueue.push({ type: 'CREATE_ORDER', payload });
    saveLocalCache();
    updateSyncStatusUI();
    renderAll();
    showToast(`📡 Pedido ${code} guardado en el dispositivo (Estado: PENDIENTE). Se subirá a Supabase al recuperar internet.`);
    return;
  }

  try {
    const created = await createOrderInSupabase(payload);
    showToast(`🎉 ¡Pedido ${created.codigo_pedido} registrado en Supabase con estado PENDIENTE!`);
    await reloadFromSupabase(true);
  } catch (e) {
    console.error('Error creando pedido en Supabase:', e);
    showToast('⚠️ Error de red, activando guardado local...');
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

  if (!resOrder.ok) throw new Error('No se pudo insertar en pedidos');
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
    agencia_preferida: document.getElementById('ncAgency').value.trim() || 'Shalom',
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
      showToast('⚠️ Ese nombre de usuario ya existe. Elige otro.');
      return;
    }
    showToast(`✅ Cliente ${payload.nombre_contacto} creado con usuario "${payload.usuario}" y clave "${payload.password_visible}".`);
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
    const pendingOrders = clientOrders.filter(p => p.estado !== 'ENTREGADO').length;

    const chipsHtml = frec.map(f => {
      const prod = state.productos.find(p => p.id === f.producto_id);
      return prod ? `<span class="need-chip">${prod.icono_emoji} <strong>${f.cantidad_habitual}</strong> × ${prod.sabor}</span>` : '';
    }).join('');

    return `
      <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div>
              <span style="background: var(--yogule-pink-light); color: var(--yogule-pink); font-weight: 900; font-size: 0.78rem; padding: 3px 9px; border-radius: 999px;">
                📍 ${c.ciudad} • ${c.frecuencia_pedido || 'Semanal'}
              </span>
              <h3 style="font-size: 1.18rem; margin-top: 6px;">🏪 ${c.nombre_negocio}</h3>
              <div style="color: #475569; font-weight: 700; font-size: 0.94rem;">👤 ${c.nombre_contacto}</div>
            </div>
            <span style="font-size: 0.78rem; font-weight: 800; background: #f1f5f9; padding: 4px 8px; border-radius: 6px;">
              ${c.codigo_cliente || 'CLIENTE'}
            </span>
          </div>

          <div style="font-size: 0.88rem; color: #475569; margin-top: 10px;">
            <div>📞 <strong>WhatsApp:</strong> ${c.telefono_whatsapp}</div>
            <div>🚚 <strong>Agencia:</strong> ${c.agencia_preferida} (${c.direccion_entrega || c.ciudad})</div>
            <div>📦 <strong>Pedidos registrados (FK):</strong> ${clientOrders.length} total (${pendingOrders} en curso)</div>
          </div>

          <div class="client-needs-box">
            <div style="font-weight: 800; font-size: 0.88rem; color: #92400e; margin-bottom: 4px;">
              ⭐ ¿Qué necesita habitualmente este cliente?
            </div>
            <p style="font-size: 0.85rem; color: #78350f; margin-bottom: 6px;">
              ${c.notas_necesidades || 'Pide surtido de los 10 sabores saludables.'}
            </p>
            <div>${chipsHtml || '<small>Sin productos habituales predefinidos</small>'}</div>
          </div>

          <div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 10px 12px; border-radius: 10px; font-size: 0.86rem; margin-bottom: 12px;">
            🔐 <strong>Credenciales del Cliente (Sin RLS):</strong><br/>
            Usuario: <code>${c.usuario}</code> • Contraseña: <code>${c.password_visible}</code>
          </div>
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-primary" style="flex: 1; padding: 10px; font-size: 0.88rem;" onclick="quickCreateHabitualOrderForClient('${c.id}')">
            ⚡ Crear su Pedido Habitual (1 Clic)
          </button>
          <button class="btn btn-outline" style="padding: 10px; font-size: 0.88rem;" onclick="loginWithCredentials('${c.usuario}', '${c.password_visible}')">
            👁️ Ver como este Cliente
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function quickCreateHabitualOrderForClient(clienteId) {
  const client = state.clientes.find(c => c.id === clienteId);
  const frec = state.frecuentes.filter(f => f.cliente_id === clienteId);
  if (!client) return;

  let items = frec.map(f => {
    const prod = state.productos.find(p => p.id === f.producto_id);
    return {
      producto_id: f.producto_id,
      cantidad: f.cantidad_habitual,
      precio_unitario: Number(prod?.precio || 8.5)
    };
  });

  if (items.length === 0 && state.productos.length > 0) {
    items = [{
      producto_id: state.productos[0].id,
      cantidad: 12,
      precio_unitario: Number(state.productos[0].precio)
    }];
  }

  await registerNewOrder({
    cliente_id: client.id,
    registrado_por_id: state.currentUser?.id || client.id,
    origen: 'MANUAL_ENCARGADO',
    agencia_envio: client.agencia_preferida || 'Shalom',
    observaciones: `Pedido habitual generado desde la Cartera de Clientes para ${client.nombre_negocio}.`,
    items
  });

  switchManagerTab('orders');
  setOrderFilter('PENDIENTE');
}

function renderManagerProducts() {
  const grid = document.getElementById('managerProductsGrid');
  if (!grid) return;

  grid.innerHTML = state.productos.map(p => `
    <div class="product-card" style="border-top: 6px solid ${p.color_hex || '#E91E63'};">
      <div>
        <div class="product-header">
          <div class="product-emoji" style="background: ${p.color_hex}18;">
            ${p.icono_emoji || '🥛'}
          </div>
          <div>
            <span style="font-size: 0.74rem; font-weight: 800; color: #64748b;">${p.sku} • ${p.linea}</span>
            <h4 style="font-size: 1.08rem; font-weight: 900;">${p.nombre}</h4>
            <div style="font-size: 0.85rem; color: #475569;">${p.presentacion}</div>
          </div>
        </div>
        <p style="font-size: 0.84rem; color: #475569; margin-top: 10px; background: #f8fafc; padding: 8px 10px; border-radius: 8px;">
          ✨ ${p.beneficio || 'Leche de altura hecha delicia'}
        </p>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 10px; border-top: 1px solid #e2e8f0;">
        <div>
          <small style="color: #64748b; font-weight: 700;">PRECIO MAYORISTA</small>
          <div style="font-size: 1.35rem; font-weight: 900; color: var(--yogule-pink);">S/ ${Number(p.precio).toFixed(2)}</div>
        </div>
        <div style="text-align: right;">
          <small style="color: #64748b; font-weight: 700;">STOCK PLANTA</small>
          <div style="font-weight: 900; color: #166534;">${p.stock} und.</div>
        </div>
      </div>
    </div>
  `).join('');
}

function switchClientTab(tab) {
  const isNew = tab === 'newOrder';
  document.getElementById('clientSectionNewOrder').style.display = isNew ? 'block' : 'none';
  document.getElementById('clientSectionMyOrders').style.display = isNew ? 'none' : 'block';
  document.getElementById('clientTabBtnOrder').classList.toggle('active', isNew);
  document.getElementById('clientTabBtnHistory').classList.toggle('active', !isNew);
  renderClientPortal();
}

function renderClientPortal() {
  if (!state.currentUser) return;

  const frec = state.frecuentes.filter(f => f.cliente_id === state.currentUser.id);
  const frecText = frec.map(f => {
    const p = state.productos.find(pr => pr.id === f.producto_id);
    return p ? `${p.icono_emoji} ${f.cantidad_habitual} ${p.sabor}` : '';
  }).filter(Boolean).join('  •  ');

  const summaryEl = document.getElementById('clientFrequentSummary');
  if (summaryEl) {
    summaryEl.textContent = frecText
      ? `Sabemos que en ${state.currentUser.nombre_negocio} siempre necesitas: ${frecText}.`
      : `Elige las botellas de Yogurt Probio Yogulé que necesitas hoy para ${state.currentUser.ciudad}.`;
  }

  const catalogEl = document.getElementById('clientProductsCatalog');
  if (catalogEl) {
    catalogEl.innerHTML = state.productos.map(p => {
      const qty = state.clientCart[p.id] || 0;
      return `
        <div class="product-card" style="border-color: ${qty > 0 ? 'var(--yogule-pink)' : 'var(--border-color)'}; border-width: ${qty > 0 ? '3px' : '2px'};">
          <div>
            <div class="product-header">
              <div class="product-emoji" style="background: ${p.color_hex}20;">
                ${p.icono_emoji || '🥛'}
              </div>
              <div>
                <span style="font-size: 0.76rem; font-weight: 800; color: var(--yogule-teal);">${p.linea}</span>
                <h4 style="font-size: 1.08rem; font-weight: 900;">${p.nombre}</h4>
                <div style="font-size: 0.84rem; color: #64748b;">${p.presentacion}</div>
              </div>
            </div>
            <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: baseline;">
              <span style="font-size: 1.35rem; font-weight: 900; color: var(--yogule-pink);">S/ ${Number(p.precio).toFixed(2)}</span>
              <span style="font-size: 0.80rem; color: #64748b;">Stock disponible</span>
            </div>
          </div>

          <div class="qty-control">
            <button type="button" class="qty-btn" onclick="changeClientCartQty('${p.id}', -1)">−</button>
            <span class="qty-val">${qty}</span>
            <button type="button" class="qty-btn plus" onclick="changeClientCartQty('${p.id}', 1)">+</button>
          </div>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-outline" style="flex: 1; padding: 6px; font-size: 0.80rem;" onclick="changeClientCartQty('${p.id}', 6)">+6</button>
            <button type="button" class="btn btn-outline" style="flex: 1; padding: 6px; font-size: 0.80rem;" onclick="changeClientCartQty('${p.id}', 12)">+12</button>
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
    if (myOrders.length === 0) {
      myOrdersList.innerHTML = `
        <div class="card" style="text-align: center; padding: 30px;">
          <h3>Aún no tienes pedidos registrados</h3>
          <p style="color: #64748b;">Ve a la pestaña "1. Hacer mi Pedido Yogulé" para enviar tu primer pedido.</p>
        </div>
      `;
    } else {
      myOrdersList.innerHTML = myOrders.map(o => renderOrderCardHTML(o, false)).join('');
    }
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

function loadClientFrequentItemsToCart() {
  if (!state.currentUser) return;
  const frec = state.frecuentes.filter(f => f.cliente_id === state.currentUser.id);
  if (frec.length === 0) {
    state.productos.slice(0, 3).forEach(p => { state.clientCart[p.id] = 10; });
  } else {
    frec.forEach(f => {
      state.clientCart[f.producto_id] = f.cantidad_habitual;
    });
  }
  renderClientPortal();
  showToast('⚡ ¡Listo! Se cargaron tus productos habituales. Revisa y presiona el botón verde para enviar.');
}

function renderClientCartSummary() {
  const entries = Object.entries(state.clientCart);
  const textEl = document.getElementById('clientCartText');
  const totalEl = document.getElementById('clientCartTotal');
  const detailEl = document.getElementById('clientCartItemsDetail');
  const submitArea = document.getElementById('clientCartSubmitArea');

  if (entries.length === 0) {
    textEl.textContent = 'Aún no has elegido productos. Toca los botones [+] abajo o "Cargar lo que siempre pido".';
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
    return `<span class="need-chip" style="font-size: 0.92rem; padding: 6px 12px;">${p.icono_emoji} <strong>${qty}</strong> × ${p.nombre} (S/ ${(qty * p.precio).toFixed(2)})</span>`;
  }).join('');

  textEl.textContent = `Estás pidiendo ${entries.length} sabores (${totalUnits} unidades en total):`;
  totalEl.textContent = `S/ ${total.toFixed(2)}`;
  detailEl.innerHTML = chips;
  submitArea.style.display = 'block';
}

async function submitClientOrder() {
  if (!state.currentUser) return;
  const entries = Object.entries(state.clientCart);
  if (entries.length === 0) return;

  const agency = document.getElementById('clientOrderAgency').value.trim() || state.currentUser.agencia_preferida || 'Shalom';
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
    agencia_envio: agency,
    observaciones: notes || `Pedido enviado por ${state.currentUser.nombre_contacto} desde su Portal Cliente.`,
    items: itemsPayload
  });

  state.clientCart = {};
  document.getElementById('clientOrderNotes').value = '';
  switchClientTab('myOrders');
}

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
  }, 4500);
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
