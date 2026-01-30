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

  const credentials = {
    type: 'service_account',
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || '',
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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
  try {
    const { dados, spreadsheetId, sheetName } = await request.json();
    
    if (!dados || dados.length === 0) {
      return NextResponse.json({ error: 'Nenhum dado fornecido' }, { status: 400 });
    }

    let auth;
    try {
      auth = getAuth();
    } catch (authError) {
      console.error('Erro de autenticação:', authError);
      return NextResponse.json({ 
        error: 'Erro de configuração',
        details: authError.message 
      }, { status: 500 });
    }

    const sheets = google.sheets({ version: 'v4', auth });
    const targetSpreadsheetId = spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID;
    const targetSheetName = sheetName || 'Movimentação';

    // Formatar dados para o formato do Google Sheets
    // Colunas: DATA | CATEGORIA | DETALHE | ORIGEM | VALOR | OBS
    const values = dados.map(d => [
      d.data,
      d.categoria,
      d.detalhe,
      d.origem,
      typeof d.valor === 'number' ? d.valor : parseFloat(d.valor) || 0,
      d.obs || ''
    ]);

    console.log('Enviando para planilha:', targetSpreadsheetId);
    console.log('Aba:', targetSheetName);
    console.log('Quantidade de linhas:', values.length);

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

    return NextResponse.json({ 
      success: true, 
      updatedRows: response.data.updates?.updatedRows || dados.length,
      message: `${dados.length} lançamento(s) adicionado(s) com sucesso!`
    });

  } catch (error) {
    console.error('Erro ao enviar para Google Sheets:', error);
    
    // Tratamento de erros específicos
    let errorMessage = 'Erro ao enviar dados para a planilha';
    let errorDetails = error.message;
    
    if (error.code === 403) {
      errorMessage = 'Acesso negado à planilha';
      errorDetails = 'Verifique se a planilha foi compartilhada com o email da Service Account';
    } else if (error.code === 404) {
      errorMessage = 'Planilha não encontrada';
      errorDetails = 'Verifique o ID da planilha nas variáveis de ambiente';
    } else if (error.message?.includes('invalid_grant')) {
      errorMessage = 'Credenciais inválidas';
      errorDetails = 'A chave da Service Account pode estar expirada. Gere uma nova no Google Cloud Console.';
    } else if (error.message?.includes('GOOGLE_')) {
      errorMessage = 'Configuração incompleta';
      errorDetails = error.message;
    }
    
    return NextResponse.json({ 
      error: errorMessage,
      details: errorDetails
    }, { status: 500 });
  }
}

// Endpoint GET para testar conexão
export async function GET() {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    
    if (!spreadsheetId) {
      return NextResponse.json({ 
        error: 'GOOGLE_SPREADSHEET_ID não configurado' 
      }, { status: 500 });
    }

    const response = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    return NextResponse.json({ 
      success: true, 
      title: response.data.properties?.title,
      sheets: response.data.sheets?.map(s => s.properties?.title)
    });

  } catch (error) {
    console.error('Erro ao conectar com Google Sheets:', error);
    return NextResponse.json({ 
      error: 'Erro ao conectar com a planilha',
      details: error.message 
    }, { status: 500 });
  }
}
