import { NextResponse } from 'next/server';
import { google } from 'googleapis';

// Configuração das credenciais a partir de variáveis de ambiente
function getAuth() {
  // Verificar variáveis obrigatórias
  const requiredVars = [
    'GOOGLE_PROJECT_ID',
    'GOOGLE_PRIVATE_KEY',
    'GOOGLE_CLIENT_EMAIL',
    'GOOGLE_SPREADSHEET_ID'
  ];
  
  const missing = requiredVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente faltando: ${missing.join(', ')}`);
  }

  // Processar a chave privada (pode vir com \n literal ou já formatada)
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';
  
  // Se a chave vier com \n literal (string), converter para quebras de linha reais
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  
  // Remover aspas extras se existirem
  privateKey = privateKey.replace(/^["']|["']$/g, '');

  const credentials = {
    type: 'service_account',
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || '',
    private_key: privateKey,
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: process.env.GOOGLE_CERT_URL || `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.GOOGLE_CLIENT_EMAIL)}`,
  };

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return auth;
}

export async function POST(request) {
  console.log('=== INICIANDO ENVIO PARA GOOGLE SHEETS ===');
  
  try {
    const { dados, spreadsheetId, sheetName } = await request.json();
    
    console.log('Dados recebidos:', dados?.length || 0, 'linhas');
    
    if (!dados || dados.length === 0) {
      return NextResponse.json({ error: 'Nenhum dado fornecido' }, { status: 400 });
    }

    let auth;
    try {
      auth = getAuth();
      console.log('✅ Autenticação configurada');
    } catch (authError) {
      console.error('❌ Erro de autenticação:', authError.message);
      return NextResponse.json({ 
        error: 'Erro de configuração',
        details: authError.message 
      }, { status: 500 });
    }

    const sheets = google.sheets({ version: 'v4', auth });
    const targetSpreadsheetId = spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID;
    const targetSheetName = sheetName || 'Movimentação';

    console.log('📊 Planilha ID:', targetSpreadsheetId);
    console.log('📋 Aba:', targetSheetName);

    // Formatar dados para o formato do Google Sheets
    // Colunas: DATA | CATEGORIA | DETALHE | ORIGEM | VALOR | OBS
    const values = dados.map(d => [
      d.data || '',
      d.categoria || '',
      d.detalhe || '',
      d.origem || '',
      typeof d.valor === 'number' ? d.valor : parseFloat(String(d.valor).replace(',', '.')) || 0,
      d.obs || ''
    ]);

    console.log('📝 Exemplo da primeira linha:', values[0]);
    console.log('📝 Total de linhas a enviar:', values.length);

    // Adicionar no final da planilha (append)
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: targetSpreadsheetId,
      range: `${targetSheetName}!A:F`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: values,
      },
    });

    console.log('✅ Resposta do Google:', response.data.updates);

    return NextResponse.json({ 
      success: true, 
      updatedRows: response.data.updates?.updatedRows || dados.length,
      message: `${dados.length} lançamento(s) adicionado(s) com sucesso!`
    });

  } catch (error) {
    console.error('❌ ERRO COMPLETO:', error);
    console.error('❌ Mensagem:', error.message);
    console.error('❌ Código:', error.code);
    console.error('❌ Status:', error.status);
    
    // Tratamento de erros específicos
    let errorMessage = 'Erro ao enviar dados para a planilha';
    let errorDetails = error.message;
    
    if (error.code === 403 || error.status === 403) {
      errorMessage = 'Acesso negado à planilha';
      errorDetails = 'A planilha precisa ser compartilhada com: ' + (process.env.GOOGLE_CLIENT_EMAIL || 'service account email');
    } else if (error.code === 404 || error.status === 404) {
      errorMessage = 'Planilha ou aba não encontrada';
      errorDetails = 'Verifique se a aba "Movimentação" existe na planilha e se o ID está correto';
    } else if (error.message?.includes('invalid_grant') || error.message?.includes('Invalid JWT')) {
      errorMessage = 'Credenciais inválidas';
      errorDetails = 'A chave da Service Account pode estar incorreta ou expirada. Gere uma nova chave no Google Cloud Console.';
    } else if (error.message?.includes('GOOGLE_')) {
      errorMessage = 'Configuração incompleta';
      errorDetails = error.message;
    } else if (error.message?.includes('private key')) {
      errorMessage = 'Chave privada inválida';
      errorDetails = 'Verifique se GOOGLE_PRIVATE_KEY está no formato correto (com BEGIN/END PRIVATE KEY)';
    }
    
    return NextResponse.json({ 
      error: errorMessage,
      details: errorDetails,
      debug: {
        hasApiKey: !!process.env.GOOGLE_PRIVATE_KEY,
        hasEmail: !!process.env.GOOGLE_CLIENT_EMAIL,
        hasSpreadsheetId: !!process.env.GOOGLE_SPREADSHEET_ID,
        errorCode: error.code,
        errorStatus: error.status
      }
    }, { status: 500 });
  }
}

// Endpoint GET para testar conexão e diagnosticar problemas
export async function GET() {
  console.log('=== DIAGNÓSTICO GOOGLE SHEETS ===');
  
  const diagnostico = {
    variaveis: {
      GOOGLE_PROJECT_ID: !!process.env.GOOGLE_PROJECT_ID,
      GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
      GOOGLE_PRIVATE_KEY_ID: !!process.env.GOOGLE_PRIVATE_KEY_ID,
      GOOGLE_CLIENT_EMAIL: !!process.env.GOOGLE_CLIENT_EMAIL,
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
      GOOGLE_SPREADSHEET_ID: !!process.env.GOOGLE_SPREADSHEET_ID,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    },
    valores: {
      projectId: process.env.GOOGLE_PROJECT_ID || 'NÃO DEFINIDO',
      clientEmail: process.env.GOOGLE_CLIENT_EMAIL || 'NÃO DEFINIDO',
      spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || 'NÃO DEFINIDO',
      privateKeyInicio: process.env.GOOGLE_PRIVATE_KEY?.substring(0, 50) || 'NÃO DEFINIDO',
      privateKeyTamanho: process.env.GOOGLE_PRIVATE_KEY?.length || 0,
    },
    conexao: null,
    planilha: null,
    erro: null
  };

  try {
    const auth = getAuth();
    diagnostico.conexao = 'Autenticação configurada';
    
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    
    if (!spreadsheetId) {
      diagnostico.erro = 'GOOGLE_SPREADSHEET_ID não configurado';
      return NextResponse.json(diagnostico, { status: 500 });
    }

    const response = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    diagnostico.conexao = 'OK - Conectado com sucesso';
    diagnostico.planilha = {
      titulo: response.data.properties?.title,
      abas: response.data.sheets?.map(s => s.properties?.title),
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
    };

    return NextResponse.json(diagnostico);

  } catch (error) {
    console.error('Erro no diagnóstico:', error);
    diagnostico.conexao = 'FALHOU';
    diagnostico.erro = {
      mensagem: error.message,
      codigo: error.code,
      status: error.status
    };
    
    // Dicas baseadas no erro
    if (error.message?.includes('invalid_grant') || error.message?.includes('Invalid JWT')) {
      diagnostico.dica = 'A chave privada está incorreta. Gere uma nova no Google Cloud Console.';
    } else if (error.code === 403) {
      diagnostico.dica = `Compartilhe a planilha com: ${process.env.GOOGLE_CLIENT_EMAIL}`;
    } else if (error.code === 404) {
      diagnostico.dica = 'Verifique se o GOOGLE_SPREADSHEET_ID está correto.';
    } else if (error.message?.includes('private key')) {
      diagnostico.dica = 'O formato da GOOGLE_PRIVATE_KEY está incorreto. Copie a chave completa do JSON.';
    }
    
    return NextResponse.json(diagnostico, { status: 500 });
  }
}
