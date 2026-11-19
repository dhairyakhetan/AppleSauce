-- Create subjects table
CREATE TABLE public.subjects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create teachers table
CREATE TABLE public.teachers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  subject_id UUID REFERENCES public.subjects(id),
  image_url TEXT,
  bio TEXT,
  experience_years INTEGER,
  location TEXT,
  whatsapp_number TEXT,
  is_verified BOOLEAN DEFAULT false,
  is_featured BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create testimonials table
CREATE TABLE public.testimonials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  author_type TEXT NOT NULL,
  author_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create profiles table for authenticated users
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Public read access for subjects, teachers, testimonials
CREATE POLICY "Anyone can view subjects" ON public.subjects FOR SELECT USING (true);
CREATE POLICY "Anyone can view teachers" ON public.teachers FOR SELECT USING (true);
CREATE POLICY "Anyone can view testimonials" ON public.testimonials FOR SELECT USING (true);

-- Profiles policies
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN new;
END;
$$;

-- Trigger for new user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Insert seed data for subjects
INSERT INTO public.subjects (name, slug) VALUES
  ('Maths', 'maths'),
  ('English', 'english'),
  ('Science', 'science'),
  ('Commerce', 'commerce'),
  ('Computer', 'computer'),
  ('Hindi', 'hindi'),
  ('History', 'history'),
  ('Geography', 'geography'),
  ('Physics', 'physics'),
  ('Chemistry', 'chemistry'),
  ('Biology', 'biology'),
  ('Economics', 'economics');

-- Insert seed data for teachers
INSERT INTO public.teachers (name, slug, subject_id, bio, experience_years, location, is_verified, is_featured)
SELECT 
  'Aloke Tiwari Sir', 'aloke-tiwari', id, 'Expert mathematics teacher with proven results', 15, 'Kolkata', true, true
FROM public.subjects WHERE slug = 'maths';

INSERT INTO public.teachers (name, slug, subject_id, bio, experience_years, location, is_verified, is_featured)
SELECT 
  'Amit Bothra Sir', 'amit-bothra', id, 'Passionate about making maths easy to understand', 10, 'Kolkata', true, true
FROM public.subjects WHERE slug = 'maths';

INSERT INTO public.teachers (name, slug, subject_id, bio, experience_years, location, is_verified, is_featured)
SELECT 
  'Ananda Panja Sir', 'ananda-panja', id, 'Commerce expert with industry experience', 12, 'Kolkata', true, true
FROM public.subjects WHERE slug = 'commerce';

INSERT INTO public.teachers (name, slug, subject_id, bio, experience_years, location, is_verified, is_featured)
SELECT 
  'Andrilla Mary Peterson', 'andrilla-peterson', id, 'Dedicated English language specialist', 8, 'Kolkata', true, true
FROM public.subjects WHERE slug = 'english';

INSERT INTO public.teachers (name, slug, subject_id, bio, experience_years, location, is_verified, is_featured)
SELECT 
  'Aparna Biswas', 'aparna-biswas', id, 'Biology teacher with research background', 11, 'Kolkata', true, true
FROM public.subjects WHERE slug = 'biology';

INSERT INTO public.teachers (name, slug, subject_id, bio, experience_years, location, is_verified, is_featured)
SELECT 
  'Aparna Dutta', 'aparna-dutta', id, 'Science teacher making concepts clear', 9, 'Kolkata', true, true
FROM public.subjects WHERE slug = 'science';

-- Insert testimonials
INSERT INTO public.testimonials (content, author_type, author_name) VALUES
  ('What impressed me first is the transparency. You immediately get a sense of the tutor''s background, strengths, and approach, and you can reach out to them directly via WhatsApp.', 'Parent, Class 8', 'Anonymous Parent'),
  ('I like how simple the website feels. It doesn''t overwhelm you, and the teacher profiles give enough detail to figure out who might suit your style. It feels built for students, not just for parents.', 'Student, Class 11', 'Anonymous Student'),
  ('ShikshAQ immediately stood out because it removes the usual guesswork. You can explore tutors calmly instead of relying on random recommendations. It feels like a modern, reliable way to choose the right teacher.', 'Student/Parent', 'Anonymous'),
  ('What impressed me most is that ShikshAQ is a student-driven initiative. It''s refreshing to see young people building something so thoughtful and organised.', 'Teacher', 'Anonymous Teacher');

-- Update timestamps trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_teachers_updated_at
  BEFORE UPDATE ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();