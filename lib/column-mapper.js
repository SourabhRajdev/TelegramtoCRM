/**
 * Column ID Mapping System
 * 
 * Translates semantic field names to real Monday.com column IDs.
 * Prevents silent write failures from placeholder column names.
 */

const logger = require('./logger');

// Module-level storage for column mappings
let columnMappings = {
  sales: {},
  artists: {},
  staff: {},
};

/**
 * Build semantic mappings from Monday.com column schemas
 */
function buildColumnMappings(boardColumns) {
  const mappings = {
    sales: {},
    artists: {},
    staff: {},
  };
  
  // Sales board semantic mappings
  if (boardColumns.sales) {
    for (const col of boardColumns.sales) {
      const title = col.title.toLowerCase();
      
      if (title.includes('phone')) mappings.sales.phone = col.id;
      if (title.includes('email')) mappings.sales.email = col.id;
      if (title.includes('whatsapp')) mappings.sales.whatsapp = col.id;
      if (title.includes('source') || title.includes('channel')) mappings.sales.source = col.id;
      if (title.includes('assigned') && title.includes('ae')) mappings.sales.assigned_ae = col.id;
      if (title.includes('pipeline') || title.includes('stage')) mappings.sales.status = col.id;
      if (title.includes('message') || title.includes('role')) mappings.sales.message = col.id;
      if (title.includes('last action')) mappings.sales.last_action = col.id;
    }
  }
  
  // Artists board semantic mappings
  if (boardColumns.artists) {
    for (const col of boardColumns.artists) {
      const title = col.title.toLowerCase();
      
      if (title.includes('phone')) mappings.artists.phone = col.id;
      if (title.includes('email')) mappings.artists.email = col.id;
      if (title.includes('whatsapp')) mappings.artists.whatsapp = col.id;
      if (title.includes('art') && title.includes('form')) mappings.artists.art_form = col.id;
      if (title.includes('specialisation')) mappings.artists.specialisation = col.id;
      if (title.includes('availability')) mappings.artists.availability = col.id;
      if (title.includes('pipeline') || title.includes('stage')) mappings.artists.status = col.id;
      if (title.includes('contract')) mappings.artists.contract_status = col.id;
      if (title.includes('rating')) mappings.artists.rating = col.id;
      if (title.includes('pricing') || title.includes('price')) mappings.artists.pricing = col.id;
      if (title.includes('experience') || title.includes('years')) mappings.artists.experience = col.id;
      if (title.includes('source') || title.includes('channel')) mappings.artists.source = col.id;
    }
  }
  
  // Staff board semantic mappings
  if (boardColumns.staff) {
    for (const col of boardColumns.staff) {
      const title = col.title.toLowerCase();
      
      if (title.includes('email')) mappings.staff.email = col.id;
      if (title.includes('phone')) mappings.staff.phone = col.id;
      if (title.includes('role') || title.includes('designation')) mappings.staff.role = col.id;
      if (title.includes('access') && title.includes('level')) mappings.staff.access_level = col.id;
      if (title.includes('assigned') && title.includes('pipeline')) mappings.staff.assigned_pipeline = col.id;
      if (title.includes('status')) mappings.staff.status = col.id;
      if (title.includes('task') || title.includes('project')) mappings.staff.tasks = col.id;
    }
  }
  
  columnMappings = mappings;
  
  logger.info('Column mappings built', {
    sales: Object.keys(mappings.sales).length,
    artists: Object.keys(mappings.artists).length,
    staff: Object.keys(mappings.staff).length,
  });
  
  return mappings;
}

/**
 * Get real column ID for semantic field
 */
function getColumnId(board, semanticField) {
  const mapping = columnMappings[board];
  if (!mapping) {
    logger.warn('No mapping for board', { board });
    return null;
  }
  
  const columnId = mapping[semanticField];
  if (!columnId) {
    logger.warn('No column ID for semantic field', { board, semanticField });
    return null;
  }
  
  return columnId;
}

/**
 * Translate semantic column_values to real Monday.com format
 */
function translateColumnValues(board, semanticValues) {
  if (!semanticValues || typeof semanticValues !== 'object') {
    return {};
  }
  
  const translated = {};
  
  for (const [semanticField, value] of Object.entries(semanticValues)) {
    const columnId = getColumnId(board, semanticField);
    
    if (!columnId) {
      logger.warn('Skipping unknown semantic field', { board, semanticField });
      continue;
    }
    
    // Translate value based on field type
    if (semanticField === 'phone' || semanticField === 'whatsapp') {
      translated[columnId] = {
        phone: value,
        countryShortName: 'AE',
      };
    } else if (semanticField === 'email') {
      translated[columnId] = {
        email: value,
        text: value,
      };
    } else if (semanticField.includes('status') || semanticField === 'source' || 
               semanticField === 'art_form' || semanticField === 'availability' ||
               semanticField === 'rating' || semanticField === 'contract_status' ||
               semanticField === 'access_level') {
      // Status/label columns
      translated[columnId] = {
        label: value,
      };
    } else {
      // Text columns
      translated[columnId] = value;
    }
  }
  
  return translated;
}

/**
 * Get all mappings (for debugging)
 */
function getAllMappings() {
  return columnMappings;
}

module.exports = {
  buildColumnMappings,
  getColumnId,
  translateColumnValues,
  getAllMappings,
};
