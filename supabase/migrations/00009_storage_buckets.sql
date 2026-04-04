-- ============================================================================
-- E-CONOMIA: Migration 00009 - Storage Buckets
-- Buckets para NFe, etiquetas, imagens de produtos
-- ============================================================================

-- Bucket: Notas Fiscais (XML + PDF)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'nfe-documents',
  'nfe-documents',
  false,  -- Privado
  5242880,  -- 5MB max
  ARRAY['application/xml', 'text/xml', 'application/pdf']
);

-- Bucket: Etiquetas de envio
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'shipping-labels',
  'shipping-labels',
  false,
  2097152,  -- 2MB max
  ARRAY['application/pdf', 'image/png', 'application/zpl']
);

-- Bucket: Imagens de produtos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,   -- Público (para exibir no frontend)
  10485760,  -- 10MB max
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
);

-- Bucket: Logos de organizações e avatares
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
);

-- ============================================================================
-- Storage RLS Policies
-- Padrão: path = {org_id}/{...} → só membros da org acessam
-- ============================================================================

-- NFe Documents: leitura e escrita por membros da org
CREATE POLICY nfe_read ON storage.objects
  FOR SELECT USING (
    bucket_id = 'nfe-documents'
    AND (storage.foldername(name))[1]::UUID IN (SELECT get_user_org_ids())
  );

CREATE POLICY nfe_write ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'nfe-documents'
    AND (storage.foldername(name))[1]::UUID IN (SELECT get_user_org_ids())
  );

-- Shipping Labels
CREATE POLICY labels_read ON storage.objects
  FOR SELECT USING (
    bucket_id = 'shipping-labels'
    AND (storage.foldername(name))[1]::UUID IN (SELECT get_user_org_ids())
  );

CREATE POLICY labels_write ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'shipping-labels'
    AND (storage.foldername(name))[1]::UUID IN (SELECT get_user_org_ids())
  );

-- Product Images: leitura pública, escrita por membros
CREATE POLICY product_images_read ON storage.objects
  FOR SELECT USING (bucket_id = 'product-images');

CREATE POLICY product_images_write ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1]::UUID IN (SELECT get_user_org_ids())
  );

CREATE POLICY product_images_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1]::UUID IN (SELECT get_user_org_ids())
  );

CREATE POLICY product_images_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1]::UUID IN (SELECT get_user_org_ids())
  );

-- Avatars: leitura pública, escrita pelo dono
CREATE POLICY avatars_read ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY avatars_write ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );
