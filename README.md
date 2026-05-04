# Harvest Control

App web para cargar stock y ventas desde Excel/CSV, calcular restante y mostrar dashboard gerencial.

## Uso local

Abra `index.html` en el navegador.

En produccion el acceso usa Supabase Auth con correo y contrasena. El rol se lee desde la tabla `profiles`.

## Formatos de carga

Stock:

```text
CONTENEDOR
CODIGO_PALLET
CALIBRE
CAJAS
```

Ventas:

```text
FECHA
CONTENEDOR
CODIGO_PALLET
CALIBRE
CAJAS_VENDIDAS
PRECIO_VENTA_TOTAL
CLIENTE
```

## Reglas

- Llave unica: `CONTENEDOR + CODIGO_PALLET + CALIBRE`.
- Un codigo pallet equivale a un pallet.
- Una caja equivale a 10 kg.
- `CALIBRE` con `*` es `CAT 1*`; sin `*` es `CAT 1`.
- El Excel no se guarda como archivo; solo se procesa la informacion.
- Las ventas sin documento se actualizan por lote: reemplazar lote o eliminar lote.
- El costo se configura en la tabla de precios, no en el Excel.
- El punto de equilibrio se configura en la tabla de precios y es informativo.
- Gerencia puede ver precios minimo, objetivo y punto de equilibrio, pero no costo.
- Precio por caja = precio venta total / cajas vendidas.
- Precio por kilo = precio venta total / kilos vendidos.
- Costo total del stock = kilos totales del stock * costo.
- Venta minima = kilos totales del stock * precio minimo.
- Venta objetivo = kilos totales del stock * precio objetivo.
- Utilidad real = ((precio venta total * 0.95) - (costo total del stock * 0.98)) / 1.19.
- Utilidad minima = ((venta minima * 0.95) - (costo total del stock * 0.98)) / 1.19.
- Utilidad objetivo = ((venta objetivo * 0.95) - (costo total del stock * 0.98)) / 1.19.
- Utilidad Bruta sobre minimo = utilidad real - utilidad minima.
- Utilidad Bruta contra objetivo = utilidad real - utilidad objetivo.

## Formulas de calculadora

- `TC. Ref. (USD/CLP)` = tipo de cambio referencial.
- `P.VENTA con IVA x KG (USD)` = `P. VENTA CON IVA x KG (Pesos Chilenos) / TC. Ref. (USD/CLP)`.
- Si `P.VENTA con IVA x KG (USD)` se edita manualmente, `P. VENTA CON IVA x KG (Pesos Chilenos)` = `P.VENTA con IVA x KG (USD) * TC. Ref. (USD/CLP)`.
- La calculadora solo calcula la fila cuando existen `Calibre`, `Cajas` y un precio de venta mayor a cero.
- `Costo Harvest` = `(Costo * 0.98) / 1.19`.
- `Ut. Bruta Harvest (Neto de Comision Cote) en USD` = `((P.VENTA con IVA x KG (USD) * Cajas * 10 * 0.95) - (Costo Harvest * Cajas * 10 * 0.98)) / 1.19`.
- `Comision Cote en USD` = `((Cajas * P.VENTA con IVA x KG (USD) * 10) / 1.19) * 0.05`.

## Nota tecnica

Esta primera version guarda datos en `localStorage` del navegador y esta preparada para migrar la persistencia a Supabase.

El archivo `supabase_schema.sql` contiene las tablas recomendadas para pasar a persistencia real:

- `profiles`
- `price_ranges`
- `stock_items`
- `sales`
- `upload_batches`

Despues de crear usuarios en Supabase Auth, agregue sus roles en `profiles`:

- `operator`
- `management`
