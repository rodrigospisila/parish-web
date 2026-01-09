import { toast, ToastOptions } from 'react-toastify';
import Swal, { SweetAlertResult } from 'sweetalert2';

// Configurações padrão do Toast
const defaultToastOptions: ToastOptions = {
  position: 'top-right',
  autoClose: 3000,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
};

// Serviço de Notificações
export const notify = {
  /**
   * Exibe uma notificação de sucesso
   */
  success: (message: string, options?: ToastOptions) => {
    toast.success(message, { ...defaultToastOptions, ...options });
  },

  /**
   * Exibe uma notificação de erro
   */
  error: (message: string, options?: ToastOptions) => {
    toast.error(message, { ...defaultToastOptions, autoClose: 5000, ...options });
  },

  /**
   * Exibe uma notificação de aviso
   */
  warning: (message: string, options?: ToastOptions) => {
    toast.warning(message, { ...defaultToastOptions, ...options });
  },

  /**
   * Exibe uma notificação informativa
   */
  info: (message: string, options?: ToastOptions) => {
    toast.info(message, { ...defaultToastOptions, ...options });
  },
};

// Serviço de Confirmações (SweetAlert2)
export const confirm = {
  /**
   * Exibe um diálogo de confirmação para exclusão
   */
  delete: async (itemName: string = 'este item'): Promise<boolean> => {
    const result: SweetAlertResult = await Swal.fire({
      title: 'Confirmar exclusão',
      text: `Tem certeza que deseja excluir ${itemName}? Esta ação não pode ser desfeita.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sim, excluir',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
    return result.isConfirmed;
  },

  /**
   * Exibe um diálogo de confirmação para desativação
   */
  deactivate: async (itemName: string = 'este item'): Promise<boolean> => {
    const result: SweetAlertResult = await Swal.fire({
      title: 'Confirmar desativação',
      text: `Tem certeza que deseja desativar ${itemName}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ffc107',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sim, desativar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
    return result.isConfirmed;
  },

  /**
   * Exibe um diálogo de confirmação para ativação
   */
  activate: async (itemName: string = 'este item'): Promise<boolean> => {
    const result: SweetAlertResult = await Swal.fire({
      title: 'Confirmar ativação',
      text: `Tem certeza que deseja ativar ${itemName}?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#28a745',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sim, ativar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
    return result.isConfirmed;
  },

  /**
   * Exibe um diálogo de confirmação genérico
   */
  action: async (
    title: string,
    text: string,
    confirmText: string = 'Confirmar',
    cancelText: string = 'Cancelar'
  ): Promise<boolean> => {
    const result: SweetAlertResult = await Swal.fire({
      title,
      text,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#007bff',
      cancelButtonColor: '#6c757d',
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      reverseButtons: true,
    });
    return result.isConfirmed;
  },

  /**
   * Exibe um diálogo de confirmação com input
   */
  withInput: async (
    title: string,
    inputLabel: string,
    inputPlaceholder: string = ''
  ): Promise<string | null> => {
    const result = await Swal.fire({
      title,
      input: 'text',
      inputLabel,
      inputPlaceholder,
      showCancelButton: true,
      confirmButtonColor: '#007bff',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Confirmar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
      inputValidator: (value) => {
        if (!value) {
          return 'Este campo é obrigatório';
        }
        return null;
      },
    });
    return result.isConfirmed ? result.value : null;
  },
};

// Exportar também o Swal para casos especiais
export { Swal };
