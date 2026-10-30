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
