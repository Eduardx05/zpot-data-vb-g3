# ZPOT Data — Visual Builder Gen 3

**Node.js + TypeScript**, interfaz ZPOT original, comparador, dashboard, diccionario funcional, consolidador y publicador de Business Objects de Oracle Visual Builder Gen 3 mediante proxy local.

## Requisitos y arranque

Node.js 20+ y npm. El navegador no necesita habilitar CORS en Oracle: el servidor Node hace las solicitudes a Business Objects.

```bash
npm install
cp .env.example .env
npm run build
npm start
```

Abre <http://127.0.0.1:8765>. En Windows puedes copiar `.env.example` como `.env` manualmente. `npm run check` valida ambos proyectos TypeScript.

## Datos y repositorio

**Este repositorio es público. No publiques datos de clientes del BNCR, ZIP, resultados ni tokens.** Los 14 ZIP y datasets históricos permanecen únicamente en `private-data/`, excluido mediante `.gitignore`. La versión pública incluye **dos conjuntos de datos DEMO SINTÉTICOS**, sin información real del BNCR, para mostrar el comparador desde el primer inicio. La demo no puede publicarse hacia Oracle.

Para restaurar los ZIP precargados desde el HTML antiguo:

```bash
python scripts/import-standalone.py /ruta/al/BNCR_ZPOT_Comparador_Consolidador_Oracle_GEN3_Pruebas.html
npm start
```

También puedes agregar ZIP nuevos desde **Agregar ZIP**; estos se procesan en tu navegador y no se envían a GitHub. Los archivos nuevos no se guardan automáticamente entre reinicios: puedes volver a cargarlos y recuperar etiquetas desde el JSON de configuración.

Las fuentes históricas, si están disponibles en `private-data/`, se muestran automáticamente al iniciar y pueden seleccionarse para comparación o consolidación. No mezcles datos bancarios con un repositorio público.

## Publicación Oracle sin CORS

Destino predeterminado de desarrollo:

```text
https://oic-vbcs-oicdesarrollo-vb-idmgdptbgc3i.builder.us-ashburn-1.ocp.oraclecloud.com/ic/builder/rt/BNCR_CREDIT_APPROVAL_2026_GEN3_V2/live/resources/data
```

El navegador envía llamadas al **mismo origen local** (`/api/oracle/Configuration`, etc.), y Node reenvía a Oracle. No se permite usar el proxy contra otros dominios ni endpoints arbitrarios.

La configuración se guarda solo en `.env` (nunca en Git):

```env
HOST=127.0.0.1
PORT=8765
ORACLE_AUTH_MODE=public
ENABLE_ORACLE_WRITES=false
```

Para usar Bearer, cambia `ORACLE_AUTH_MODE=bearer` y configura `ORACLE_BEARER_TOKEN=...` en `.env`. Para permitir POST/PATCH **únicamente en un entorno aislado de desarrollo**, cambia `ENABLE_ORACLE_WRITES=true` y reinicia Node. La interfaz requiere confirmación explícita y limita los registros por objeto; la exportación ZIP y la vista previa no escriben en Oracle.

> El segmento `live` en `/ic/builder/rt/.../live/` designa la publicación de una aplicación y no garantiza que el entorno sea producción. Verifica el ambiente y realiza respaldo antes de cualquier carga. La prueba GET no valida permisos POST o PATCH, ni garantiza que la importación conserve dependencias entre objetos.

## Funcionalidades conservadas

- Exploración y diccionario de catálogos, mantenimientos, procesos, etapas, roles y flujo dinámico.
- Selector de ZIP precargados y nuevos, dashboards y casos registrados.
- Comparación de objetos/filas por ID entre varias fuentes.
- Consolidador CSV con deduplicación por `id`, prioridad de `lastUpdateDate`, exportación ZIP con esquema de referencia y auditoría.
- JSON para nombres personalizados, fecha de pase, ambiente declarado, prioridades y preferencias de fuentes.
- Publicador API con GET de comprobación, vista previa, POST/PATCH/Upsert cuando sea admitido, detención y reporte de resultados.

## Seguridad

- Node escucha solo `127.0.0.1`/`localhost`. No se habilita CORS abierto.
- La API valida `Host`, `Origin`, objeto, identificador, método y destino Oracle.
- Autenticación gestionada **solo por el servidor**; los tokens no se transmiten al frontend.
- POST/PATCH requieren dos habilitaciones: variable explícita de servidor y confirmación del usuario en la interfaz.
- El código fuente publicado no contiene archivos ni registros del BNCR.
- Para producción se necesita un procedimiento de migración autorizado con respaldo, validación de esquemas/relaciones y credenciales con privilegios mínimos.

## Orden de carga por relaciones — migración por etapas

En **Publicar en Oracle → Plan de carga por relaciones**, ZPOT calcula un orden topológico utilizando las relaciones `outgoing` del modelo de Business Objects, tomando la metadata de los ZIP de aplicación y del diccionario precargado.

- Los **objetos padre** se importan antes que los objetos dependientes. Por ejemplo, `AbsenceLapseCatalogue` y `AbsenceTypeCatalogue` antes de `AbsenceCatalogue`; `Process` y `ProcessStages` antes de `ProcessStageProcess`; `Cases`, `ProcessStages` y `CaseStageStatus` antes de `CaseStage`.
- El modo predeterminado envía **una etapa a la vez**, pide confirmación adicional por etapa y conserva la auditoría JSON con el orden, los registros procesados y los errores.
- Antes de escribir cada etapa hace GET de la colección y comprueba las referencias a registros padres que no se hayan cargado en esta ejecución, con un máximo de 250 consultas de referencia por etapa. Si la validación falla, se detiene.
- Un error de POST/PATCH **detiene las etapas dependientes**. No se reintentan inserciones automáticamente, para evitar duplicados.
- Si la importación abarca varias tablas con llaves foráneas, hay que preservar los IDs originales o preparar una estrategia de remapeo. No se remapean automáticamente IDs que genere Oracle.
- Las relaciones circulares o las autorreferencias que no puedan resolverse se señalan explícitamente. La herramienta no presume un orden inventado.
- **Restablecer plan** inicia un nuevo intento pero **no revierte** los registros ya insertados. Conciliar y respaldar antes de reintentar. El progreso entre etapas no se guarda al recargar la página.
- El **orden de publicación** proviene de las llaves foráneas del modelo, NO de `orderPos`, que controla el flujo dinámico de negocio.

Este procedimiento está diseñado para **un ambiente de desarrollo aislado**. Un GET exitoso no concede permiso POST/PATCH: el servidor Oracle debe autorizar cada operación. No existe transacción ni rollback global.

## Publicación por ID y diagrama de dependencias

En **Publicar en Oracle** marca el objeto hijo deseado: ZPOT selecciona sus Business Objects padre disponibles, y el diagrama **padre → hijo** permite navegar por las dependencias y consultar el nombre exacto de cada campo FK.

El modo predeterminado **Automático por ID** hace:
1. GET del objeto por su `id` original; **200** → PATCH al mismo ID.
2. Solo **404** → POST (creación). **403, 401, 5xx, errores de red y timeouts** detienen la carga sin crear a ciegas.
3. Si Oracle devuelve otro ID al crear, registra la correspondencia `idOrigen → idOracle` y actualiza los FK de los objetos hijos durante **la misma sesión de carga**.
4. Las referencias a padres no incluidos en los ZIP se comprueban contra Oracle, y las referencias faltantes detienen el envío. Los registros que se relacionan consigo mismos dentro de una tabla se ordenan padres primero.
5. El **JSON de auditoría** incluye conteos de creados y actualizados, campos FK remapeados y las equivalencias por objeto.

Los vínculos se basan exclusivamente en **IDs de relaciones declaradas en Visual Builder**; no se infieren relaciones por nombres. Conservar un ID original en el payload no garantiza que Oracle lo mantenga.

**Limitación de reintentos:** el mapa de IDs generados se mantiene en memoria durante la sesión. Guarda la auditoría y verifica los registros antes de reiniciar o repetir la carga; si Oracle generó nuevos IDs, un reintento posterior basado solo en el ID original podría crear duplicados. No se realiza un rollback automático.

**Importante:** para realizar cambios, el usuario técnico necesita permisos Oracle de POST/PATCH. El proxy puede rechazar escritura si `ENABLE_ORACLE_WRITES=false`, pero habilitarlo no resuelve permisos Oracle 403.

## Modelo maestro de relaciones derivado de la aplicación

El planificador **no necesita inferir las relaciones de los 104 BO desde los CSV**. Se incorporó `client/bo-master-model.ts`, generado a partir de los `entity.json` incluidos en las dos exportaciones que proporcionó el usuario:

- `BNCR_CREDIT_APPROVAL_UUID_SUPPORT_MIGRADO_V5`
- `BNCR_CREDIT_APPROVAL 3.0.37`

Se comprobó que ambas exportaciones comparten **104 objetos** y **96 relaciones salientes declaradas** (`mappingField` → `targetEntity`). El repositorio público solo contiene el **nombre del objeto y los campos de relación**, sin filas de clientes, configuración secreta ni credenciales. Para un BO reconocido, estas relaciones del modelo tienen prioridad sobre las inferencias por nombre de columna. La inferencia se reserva a objetos futuros que no formen parte del modelo.

**Publicar en Oracle → Mapa visual:** puedes cambiar entre *BO seleccionados para publicar* y *Modelo completo: 104 BO y 96 relaciones*. Las flechas verdes muestran las relaciones reales por ID. Las flechas grises discontinuas muestran únicamente preferencias de orden de importación.

Ejemplos del modelo:
- `AbsenceCatalogue.absenceTypeCatalogue → AbsenceTypeCatalogue.id`
- `AbsenceCatalogue.absenceLapseCatalogue → AbsenceLapseCatalogue.id`
- `AppraisalUsed.cases → Cases.id`
- `ProcessStageProcess.process → Process.id`
- `ProcessStageProcess.processStages → ProcessStages.id`

Por preferencia funcional, se carga `AbsenceTypeCatalogue` antes de `AbsenceLapseCatalogue`; **NO existe una FK directa entre estos dos catálogos**. Ambos deben cargarse antes de `AbsenceCatalogue`.

El mismo mapa maestro se aplica a la selección automática de padres, el orden por etapas, la validación de referencias por ID y el remapeo de llaves foráneas. Si un objeto futuro no está en ese modelo, se usa su definición declarada en el ZIP; solo cuando tampoco exista, se intenta inferir por coincidencia exacta de columna y se marca la relación como inferida para revisión.


### Importar con PATCH y mantener los IDs de los Business Objects

En **Publicar en Oracle → Modo de escritura** están disponibles:
- **Por ID: PATCH existente / POST nuevo (solo 404)** (predeterminado): consulta el ID en Oracle; si existe, envía PATCH a ese ID. Si Oracle confirma que no existe (HTTP 404), crea mediante POST. Cualquier error 401/403/5xx o de red cancela sin crear otro registro.
- **Solo PATCH · actualizar IDs existentes, sin crear:** no realiza POST; si el ID no existe, detiene la etapa.
- Los métodos POST y Upsert heredados siguen disponibles para pruebas específicas y requieren revisar duplicados por separado.

El cuerpo PATCH **excluye el campo `id`** para no intentar cambiar la clave primaria. El cuerpo POST puede incluir el ID original cuando `Intentar conservar id original` está habilitado, pero Oracle puede asignar un nuevo ID igualmente.

Cuando Oracle crea un registro y devuelve otro ID, ZPOT guarda la equivalencia `ID origen → ID Oracle`; las FK de los hijos se remapean en esa sesión. El reporte JSON contiene `idMappings`. Antes de **repetir una importación**, utiliza el botón **Importar equivalencias de IDs (auditoría JSON)** para cargar un reporte del **mismo endpoint**, de modo que los registros creados anteriormente se actualicen mediante PATCH al ID real de Oracle. El archivo no se guarda en Git ni en `localStorage`. Guarda una copia privada de la auditoría.

**PATCH no inserta filas inexistentes.** Si Oracle no devuelve el ID del registro creado ni en la respuesta ni en la cabecera Location, ZPOT intenta comprobar el ID original mediante GET y, si no puede identificar el registro, detiene la carga para evitar relaciones incorrectas. No reintentes a ciegas una creación que devolvió una respuesta ambigua.

En el ambiente controlado de OIC Desarrollo se permite migrar también `Configuration`, pero sus parámetros de URL/seguridad se señalan como advertencia en el reporte y se incluyen sin modificarlos.


### Conflicto de unicidad al migrar IDs de catálogos

Si `GET /AbsenceTypeCatalogue/1` devuelve `404`, pero Oracle ya contiene el mismo `absenceName` con otro ID, **POST puede responder `400 uniquenessViolation`**. ZPOT ahora consulta primero las claves `unique:true` declaradas en el `entity.json` original: realiza una búsqueda exacta del campo, identifica un único ID Oracle, actualiza mediante **PATCH** y guarda el vínculo `ID origen → ID Oracle` para las referencias de los hijos. Ejemplo: `AbsenceTypeCatalogue.id=1` → `Oracle.id=7` por `absenceName`; los valores FK de `AbsenceCatalogue` se remapean al ID `7` dentro de esa sesión.

Si Oracle no admite filtros `q`, el publicador realiza una lectura paginada de respaldo con un límite conservador. Si hay coincidencias ambiguas, datos incompletos, errores de lectura o colisiones con IDs ya asociados a otra fila de origen, **no realiza PATCH ni POST automáticos**. Los errores originales se conservan para revisión. No se hacen coincidencias aproximadas ni por nombres de campos no declarados únicos.

Selecciona **Por ID: PATCH existente / POST nuevo (solo 404)** en el desplegable; los modos heredados `POST` y `Upsert-Mode` no ejecutan esta reconciliación de unicidad. Reinicia Node y fuerza una recarga del navegador tras actualizar el proyecto.


### Omitir filas conflictivas y conservar referencias seguras

En **Publicar en Oracle**, el interruptor **«Ante errores de fila, omitir y continuar»** está activado de manera predeterminada en el entorno controlado de desarrollo. La política es:

- **Prioridad 1:** localizar un registro Oracle existente por ID o por una clave `unique:true` del modelo `entity.json`; si hay un único ID confirmado, hacer PATCH y registrar la equivalencia para los hijos.
- **Prioridad 2:** si un registro recibe un error recuperable específico de fila (`HTTP 400`, `404`, `409`, `422`, o coincidencia ambigua), **omitir solo esa fila**. Registrar objeto, ID, campo único, valor del campo no secreto, tipo/código de Oracle y explicación en `skippedRecords` del reporte JSON.
- **Protección de relaciones:** cada fila hija se valida inmediatamente antes del envío. Si depende de un ID padre omitido, también se omite; **no se publican FK apuntando a un ID de origen posiblemente incorrecto**. Los objetos y registros independientes continúan según el plan de etapas.
- **Errores críticos:** permisos `401/403`, fallos `5xx`, red, respuestas ambiguas después de escritura o incompatibilidades no recuperables siguen **deteniendo** la carga, pues omitirlos puede ocultar corrupción o escrituras parciales.
- La finalización con omisiones indica `completed-with-omissions` (no éxito completo). Descarga la auditoría con `skippedRecords` e `idMappings` antes de repetir la carga.

Desactiva el interruptor si deseas el comportamiento estricto de detener ante la primera fila conflictiva. Esta opción no elimina ni altera datos existentes y no ejecuta `rollback`.


## Fusión de aplicaciones Oracle (página nueva e independiente)

En la navegación de ZPOT, abre **Fusionar aplicaciones Oracle**. Esta funcionalidad **no sustituye ni altera** el consolidador CSV ni el publicador existente.

1. Usa **＋ Cargar uno o dos ZIP adicionales** si las exportaciones no aparecen todavía; elige explícitamente el **ZIP antiguo** (fuente prioritaria de catálogos) y el **ZIP nuevo** (casos y cambios recientes).
2. Pulsa **Analizar y generar vista previa**. El procesamiento se efectúa localmente en el navegador, sin enviar los CSV al repositorio ni a Oracle. Puedes revisar por BO cantidad antigua, nueva, final, nuevas filas, coincidencias, conflictos e IDs reasignados. La prueba incluye 14.000 registros de `Cases` y no impone un límite artificial de 10.000 filas del ZIP.
3. Descarga la **auditoría JSON**. Incluye `idMappings.old` e `idMappings.new` por BO, reglas de prioridad, conflictos, referencias no resueltas y métricas. Los ZIP originales permanecen intactos.
4. Selecciona el **destino**: descargar ZIP plano para revisión/Data Manager, o preparar el ZIP en el **publicador API de OIC Desarrollo** ya existente. En el segundo caso la herramienta solo hace el traspaso local y abre la página de publicación. Antes de cualquier escritura deberás confirmar el destino, comprobar GET y autorizar explícitamente la operación.

**Reglas iniciales conservadoras.** Los catálogos mantienen los valores existentes de la versión antigua y añaden los nuevos. `Cases` solo se identifica entre fuentes por un `opportunityNumber` no vacío y verificable; igualdad de `id` entre dos aplicaciones **no acredita** el mismo expediente. `Configuration` identifica claves mediante `keyCatalog` o `key`; solo prefiere cambios nuevos cuando `lastUpdateDate` es estrictamente posterior. Los BO de operación/historial preservan las filas de ambas fuentes. Cuando dos registros distintos tienen el mismo ID, se asigna un ID diferente al entrante y se reescriben las FK declaradas del modelo maestro. Un valor `unique:true` que es FK (por ejemplo `cases`) **no se usa** como identidad entre aplicaciones, ya que su ID no pertenece a un espacio global.

**Seguridad de la consolidación.** Los conflictos ambiguos, IDs de origen duplicados y FK no resueltas se informan; el ZIP puede descargarse como **diagnóstico**, con nombre `NO_PUBLICAR`, pero el traspaso al publicador se deshabilita mientras existan errores bloqueantes. Antes de importar el ZIP mediante Data Manager hay que verificar la semántica de reemplazo de Oracle; el ZIP de diagnóstico no se debe importar. Incluso con cero conflictos internos, es necesario comprobar la identidad de los registros del **destino real** para evitar sobrescribir BO que tengan IDs coincidentes. El nuevo módulo **no efectúa escrituras directas** ni modifica las protecciones del publicador original.

**Límites explícitos.** Sin una clave de negocio estable, dos registros modificados de fuentes distintas pueden quedar conservados como filas separadas y requerir conciliación manual. El módulo no intenta identificar expedientes por nombre de personas ni por coincidencias aproximadas. La prioridad se aplica sobre valores, pero las diferencias de estructura y los campos que el destino no admita deben revisarse antes de publicar.


### ZIP existente en Oracle + ZIP de cambios — fusión diferencial por API batch

La página **Fusionar aplicaciones Oracle** ahora usa dos roles explícitos:

- **ZIP A (ya existe en Oracle):** es una exportación reciente del **destino OIC Desarrollo**, cuyos IDs deben conservarse. ZPOT no reenvía filas sin cambios; el operador debe confirmar manualmente que este ZIP representa el destino real. Confirmar no hace una consulta de integridad exhaustiva ni comprueba que Oracle no haya cambiado desde la exportación.
- **ZIP B (cambios):** añade registros nuevos, y modifica únicamente campos de registros identificados sin ambigüedad mediante claves de negocio (por ejemplo `Cases.opportunityNumber`). Los registros sin identidad verificable no se unen por simple coincidencia del número `id`.

**Revisión de incidencias:** filtros por BO/ID/severidad, controles por fila y acciones masivas para colisiones de un mismo BO. Es posible conservar ambos registros y reasignar el ID entrante, omitir la fila de ZIP B, aplicar una conciliación verificada o asignar explícitamente el ID de un padre. **Los registros del ZIP A no pueden excluirse mediante decisiones manuales**. Una referencia a un padre inexistente bloquea la publicación. Descarga el JSON de auditoría para conservar las decisiones tomadas.

**Salidas distintas:** el ZIP **completo** es una vista para revisión; el **ZIP diferencial** contiene únicamente registros nuevos o campos modificados (PATCH). Un caso como 14.000 `Cases` sin cambios y dos modificaciones solo genera esas dos escrituras. La opción «Preparar solo cambios en Oracle» transfiere exclusivamente el ZIP diferencial al publicador original; la V1 permanece intacta.

**API batch independiente:** la misma página ofrece una opción optativa para escribir el diferencial vía `POST /api/oracle-batch`, que reenvía a la URL de datos `/resources/data` de la aplicación OIC Desarrollo autorizada, usando el tipo `application/vnd.oracle.adf.batch+json` y el formato `{ "parts": [{"id":"p1","path":"/Cases/17","operation":"update","payload":{"state":"..."}}] }`. El proxy exige `ENABLE_ORACLE_WRITES=true`, `X-ZPOT-Request: 1` y `X-ZPOT-Write-Confirm: CARGAR DESARROLLO`, valida las rutas de BO y **solo permite `create` y `update`**; nunca acepta delete, URLs externas ni cambios de `id` durante update.

Se envían lotes de **5, 10 (predeterminado) o 25** registros, con **1, 2 (predeterminado) o 3 solicitudes concurrentes**. Cada lote es atómico según el contrato REST de Oracle; las **etapas con dependencias padre→hijo se ejecutan secuencialmente**. Si el servidor asigna un ID diferente al crear, se registra y reescribe en las FK de lotes de etapas posteriores. No se emiten lotes con dependencias internas a nuevas filas del mismo BO si podrían requerir IDs todavía desconocidos.

**Recuperación:** el botón «Detener después de los lotes en curso» deja terminar los lotes ya enviados; descarga el JSON de auditoría para confirmar operaciones. En una nueva sesión puedes cargar ese JSON **solo si el estado es `paused`**, con los mismos ZIP/destino y tras comprobar GET. Los estados `needs-reconciliation` debidos a timeouts, respuestas ambiguas o errores **no se reintentan automáticamente**: es necesario consultar Oracle antes de decidir qué reanudar. Tampoco se vuelve a ejecutar la carga si el JSON ya indica `completed`.

**Verificación antes de ejecutar contra el banco:** el código fue validado mediante pruebas de integración simulada, pero **no se ha probado mediante escrituras reales a Oracle**. Primero ejecuta una carga controlada con 1 lote de 5 registros de prueba y verifica `parts`, IDs y el comportamiento transaccional. Mantén un respaldo del destino.
