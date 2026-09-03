export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      job_steps: {
        Row: {
          duration_ms: number | null
          error: string | null
          id: string
          input: Json | null
          job_id: string
          model: string | null
          output: Json | null
          prompt_snapshot: string | null
          run_count: number
          status: string
          step_key: string
          step_order: number
          tokens_in: number
          tokens_out: number
          updated_at: string
        }
        Insert: {
          duration_ms?: number | null
          error?: string | null
          id?: string
          input?: Json | null
          job_id: string
          model?: string | null
          output?: Json | null
          prompt_snapshot?: string | null
          run_count?: number
          status?: string
          step_key: string
          step_order?: number
          tokens_in?: number
          tokens_out?: number
          updated_at?: string
        }
        Update: {
          duration_ms?: number | null
          error?: string | null
          id?: string
          input?: Json | null
          job_id?: string
          model?: string | null
          output?: Json | null
          prompt_snapshot?: string | null
          run_count?: number
          status?: string
          step_key?: string
          step_order?: number
          tokens_in?: number
          tokens_out?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_steps_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          context: Json
          created_at: string
          created_by: string
          current_step: string | null
          id: string
          market_id: string
          source_url: string
          status: string
          updated_at: string
        }
        Insert: {
          context?: Json
          created_at?: string
          created_by: string
          current_step?: string | null
          id?: string
          market_id: string
          source_url: string
          status?: string
          updated_at?: string
        }
        Update: {
          context?: Json
          created_at?: string
          created_by?: string
          current_step?: string | null
          id?: string
          market_id?: string
          source_url?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      link_pool: {
        Row: {
          anchor_text: string | null
          content_type: string
          fetched_at: string
          http_status: number | null
          id: string
          market_id: string
          origin: string
          path_type: string
          source_page: string
          url: string
        }
        Insert: {
          anchor_text?: string | null
          content_type?: string
          fetched_at?: string
          http_status?: number | null
          id?: string
          market_id: string
          origin?: string
          path_type?: string
          source_page: string
          url: string
        }
        Update: {
          anchor_text?: string | null
          content_type?: string
          fetched_at?: string
          http_status?: number | null
          id?: string
          market_id?: string
          origin?: string
          path_type?: string
          source_page?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_pool_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      markets: {
        Row: {
          active: boolean
          address_form: string | null
          brand: string
          category_root: string
          closing_note: string | null
          country: string
          crawl_delay_ms: number
          created_at: string
          domain: string
          forbidden_claims: Json
          id: string
          index_last_run: string | null
          institutions: Json
          language: string
          language_variant: string
          locale: string | null
          magazine_root: string
          path_map: Json
          path_prefix: string
          search_url_pattern: string | null
        }
        Insert: {
          active?: boolean
          address_form?: string | null
          brand: string
          category_root?: string
          closing_note?: string | null
          country: string
          crawl_delay_ms?: number
          created_at?: string
          domain: string
          forbidden_claims?: Json
          id?: string
          index_last_run?: string | null
          institutions?: Json
          language: string
          language_variant?: string
          locale?: string | null
          magazine_root?: string
          path_map?: Json
          path_prefix?: string
          search_url_pattern?: string | null
        }
        Update: {
          active?: boolean
          address_form?: string | null
          brand?: string
          category_root?: string
          closing_note?: string | null
          country?: string
          crawl_delay_ms?: number
          created_at?: string
          domain?: string
          forbidden_claims?: Json
          id?: string
          index_last_run?: string | null
          institutions?: Json
          language?: string
          language_variant?: string
          locale?: string | null
          magazine_root?: string
          path_map?: Json
          path_prefix?: string
          search_url_pattern?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      prompt_templates: {
        Row: {
          description: string
          id: string
          is_active: boolean
          max_tokens: number
          model: string
          name: string
          response_format: string
          sort_order: number
          step_key: string
          system_prompt: string
          temperature: number
          updated_at: string
          updated_by: string | null
          user_prompt: string
          variables: Json
          version: number
        }
        Insert: {
          description?: string
          id?: string
          is_active?: boolean
          max_tokens?: number
          model?: string
          name: string
          response_format?: string
          sort_order?: number
          step_key: string
          system_prompt?: string
          temperature?: number
          updated_at?: string
          updated_by?: string | null
          user_prompt?: string
          variables?: Json
          version?: number
        }
        Update: {
          description?: string
          id?: string
          is_active?: boolean
          max_tokens?: number
          model?: string
          name?: string
          response_format?: string
          sort_order?: number
          step_key?: string
          system_prompt?: string
          temperature?: number
          updated_at?: string
          updated_by?: string | null
          user_prompt?: string
          variables?: Json
          version?: number
        }
        Relationships: []
      }
      prompt_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          max_tokens: number | null
          model: string | null
          response_format: string | null
          system_prompt: string
          temperature: number | null
          template_id: string
          user_prompt: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          max_tokens?: number | null
          model?: string | null
          response_format?: string | null
          system_prompt?: string
          temperature?: number | null
          template_id: string
          user_prompt?: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          max_tokens?: number | null
          model?: string | null
          response_format?: string | null
          system_prompt?: string
          temperature?: number | null
          template_id?: string
          user_prompt?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "prompt_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      style_profiles: {
        Row: {
          content_type: string
          created_at: string
          id: string
          market_id: string
          profile: Json
        }
        Insert: {
          content_type?: string
          created_at?: string
          id?: string
          market_id: string
          profile: Json
        }
        Update: {
          content_type?: string
          created_at?: string
          id?: string
          market_id?: string
          profile?: Json
        }
        Relationships: [
          {
            foreignKeyName: "style_profiles_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      url_index: {
        Row: {
          breadcrumb: string | null
          canonical: string | null
          h1: string | null
          http_status: number | null
          id: string
          intro_text: string | null
          last_seen: string
          market_id: string
          meta_description: string | null
          path_type: string
          title: string | null
          url: string
        }
        Insert: {
          breadcrumb?: string | null
          canonical?: string | null
          h1?: string | null
          http_status?: number | null
          id?: string
          intro_text?: string | null
          last_seen?: string
          market_id: string
          meta_description?: string | null
          path_type?: string
          title?: string | null
          url: string
        }
        Update: {
          breadcrumb?: string | null
          canonical?: string | null
          h1?: string | null
          http_status?: number | null
          id?: string
          intro_text?: string | null
          last_seen?: string
          market_id?: string
          meta_description?: string | null
          path_type?: string
          title?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "url_index_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verified_links: {
        Row: {
          anchor: string
          canonical_ok: boolean
          confidence: string | null
          created_at: string
          http_status: number | null
          id: string
          job_id: string
          source: string
          target_url: string
        }
        Insert: {
          anchor: string
          canonical_ok?: boolean
          confidence?: string | null
          created_at?: string
          http_status?: number | null
          id?: string
          job_id: string
          source?: string
          target_url: string
        }
        Update: {
          anchor?: string
          canonical_ok?: boolean
          confidence?: string | null
          created_at?: string
          http_status?: number | null
          id?: string
          job_id?: string
          source?: string
          target_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "verified_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "editor" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "editor", "viewer"],
    },
  },
} as const
