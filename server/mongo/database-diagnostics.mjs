// Never return raw driver messages: they can contain credentials or patient values.
export function databaseDiagnostic(error,fallbackStage='backend-import'){
  const code=Number.isSafeInteger(error?.code)?error.code:null;
  const stage=/^(connect|ping|system-modules|owner-setup|backend-import|indexes:[a-z_]+)$/.test(error?.initializationStage??'')?error.initializationStage:fallbackStage;
  let hint='Check Atlas connectivity and the private MongoDB settings.';
  if(code===18||/bad auth|authentication failed|auth failed/i.test(error?.message??''))hint='Atlas authentication failed. Verify the database username/password in MONGODB_URI and URL-encode reserved password characters.';
  else if(code===13)hint='Atlas permission denied. Grant the application database user readWrite on the database named by MONGODB_DB.';
  else if(code===85||code===86)hint='An existing index has conflicting options. Review its definition; do not delete records or indexes blindly.';
  else if(code===11000)hint='Duplicate stored values prevent a unique index or owner setup. Existing data needs review; do not reset the database.';
  else if(code===67||code===2)hint='MongoDB rejected an index or command definition. Review the initialization stage and server compatibility.';
  else if(/tls|ssl|certificate/i.test(error?.message??''))hint='TLS connection failed. Check Atlas Network Access for the hosting server outbound IP and the Atlas connection string.';
  return {code,stage,hint};
}
