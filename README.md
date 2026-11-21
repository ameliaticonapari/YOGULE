# YOGULÉ • Sistema de Pedidos y Trazabilidad Nacional

> **Agroindustria Yogulé S.A.C.** • Distrito de Cabana, Provincia de San Román (Juliaca) - Puno, Perú  
> *"Leche de altura hecha delicia"* • **Único con 10 Sabores Saludables (Yogurt Probio 1000 cc)**

---

## 🎯 Objetivo del Sistema

Eliminar los errores manuales y olvidos al copiar pedidos por WhatsApp de clientes en distintas ciudades del Perú, brindando **trazabilidad exacta en 3 estados** desde que el cliente hace su pedido hasta la entrega:

1. 🟠 **`PENDIENTE`**: Cuando el cliente registra su pedido (o la encargada pega el mensaje de WhatsApp a costo $0).
2. 🔵 **`RECIBIDO`**: Cuando la encargada ya vio el pedido y marcó el checklist anti-olvido de productos alistados.
3. 🟢 **`ENTREGADO`**: Cuando ya se realizó la entrega final de los productos al cliente.

---

## 🗄️ Base de Datos Conectada en Supabase (Sin RLS)

- **Organización:** `YOGULE`
- **Proyecto:** `YOGULE` (`bpaxkwzbknmntqdsdzwu`)
- **URL API:** `https://bpaxkwzbknmntqdsdzwu.supabase.co`
- **Esquema SQL:** [`database/schema_yogule.sql`](database/schema_yogule.sql)

## 🔐 Cuentas de Prueba (Acceso sin RLS desde tabla `clientes`)

| Rol | Nombre / Negocio | Ciudad | Usuario | Contraseña |
| :--- | :--- | :--- | :--- | :--- |
| 👩‍💼 **Encargada Planta** | Amelia Ticona (Planta Central Yogulé) | Cabana - Juliaca | `encargada` | `yogule123` |
| 🏪 **Cliente** | María Quispe (Distribuidora El Misti) | Arequipa | `maria_arequipa` | `123456` |
| 🏪 **Cliente** | Carlos Huamán (Mercado Wanchaq) | Cusco | `carlos_cusco` | `123456` |
| 🏪 **Cliente** | Rosa Condori (Minimarket Los Andes) | Juliaca | `rosa_juliaca` | `123456` |
| 🏪 **Cliente** | Jorge Mendoza (BioTienda Miraflores) | Lima | `jorge_lima` | `123456` |
| 🏪 **Cliente** | Elena Paredes (Comercial del Norte) | Trujillo | `elena_trujillo` | `123456` |
