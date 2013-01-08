<?php

class Migration {
	var $name;
	var $sql;
	var $mayFail;
	function Migration( $name,
			    $sql,
			    $mayFail = FALSE ) {
		$this->name = $name;
		$this->sql = $sql;
		$this->mayFail = $mayFail;
	}
	function apply( $db, $ignoreErrors ) {
		try {
			error_log("Running the migration: ".$this->name);
			$db->getResult("SAVEPOINT generic_migration");
			$db->getResult($this->sql);
		} catch( Exception $e ) {
			if ($ignoreErrors || $this->mayFail) {
				error_log("Ignoring the failed migration: ".$e);
				$db->getResult("ROLLBACK TO SAVEPOINT generic_migration");
			} else {
				error_log("The migration failed: ".$e);
				throw $e;
			}
		}
	}
}

// This is a special migration that we can't easily do with pure SQL.
// It inserts any missing lines into the treenode_connector table,
// based on the old way of describing synapses:

class SpecialConnectorMigration {
    var $name = "Add any rows missing from the treenode_connector table";
    function apply( $db, $ignoreErrors) {
        try {
            error_log("Running the migration: ".$this->name);
            $db->getResult("SAVEPOINT connector_migration");

            foreach( $db->getResult("SELECT id FROM project") as $p ) {
                $project_id = $p['id'];
                error_log("Dealing with project: ".$project_id);

                // Get a map of all the relation names to IDs in this
                // project:
                $relation_result = $db->getResult("SELECT relation_name, id FROM relation WHERE project_id = ".$project_id);
                $relations = array();
                foreach( $relation_result as $r ) {
                    $relations[$r['relation_name']] = intval($r['id']);
                }

                // Get a map of all the class names to IDs in this
                // project:
                $class_result = $db->getResult("SELECT class_name, id FROM class WHERE project_id = ".$project_id);
                $classes = array();
                foreach( $class_result as $r ) {
                    $classes[$r['class_name']] = intval($r['id']);
                }

                if (!isset($relations['presynaptic_to'])) {
                    // Then this project probably isn't set up for tracing
                    continue;
                }

                foreach( array('presynaptic', 'postsynaptic') as $direction ) {

                    $direction_relation_id = $relations[$direction . '_to'];
                    $terminal_class_id = $classes[$direction . ' terminal'];
                    $model_of_id = $relations['model_of'];
                    $synapse_class_id = $classes['synapse'];
                    $results = $db->getResult(<<<EOSQL
SELECT tn.id as tnid, c.id as cid, terminal1_to_syn.user_id as user_id
  FROM treenode tn,
       treenode_class_instance tci,
       class_instance terminal1,
       class_instance_class_instance terminal1_to_syn,
       class_instance syn,
       connector_class_instance syn_to_connector,
       connector c
  WHERE tn.project_id = $project_id
    AND tn.id = tci.treenode_id
    AND tci.relation_id = $model_of_id
    AND terminal1.id = tci.class_instance_id
    AND terminal1.class_id = $terminal_class_id
    AND terminal1.id = terminal1_to_syn.class_instance_a
    AND terminal1_to_syn.relation_id = $direction_relation_id
    AND syn.id = terminal1_to_syn.class_instance_b
    AND syn.class_id = $synapse_class_id
    AND syn.id = syn_to_connector.class_instance_id
    AND syn_to_connector.relation_id = $model_of_id
    AND syn_to_connector.connector_id = c.id
EOSQL
                        );

                    foreach ($results as $row) {
                        $treenode_id = $row['tnid'];
                        $connector_id = $row['cid'];
                        $user_id = $row['user_id'];

                        // Do a quick check that this relationship isn't already
                        // recorded in the treenode_connector table.  It shouldn't
                        // create a problem if we end up with duplicate entries,
                        // but try to avoid that:

                        $check_result = $db->getResult(<<<EOSQL
SELECT id
  FROM treenode_connector
  WHERE treenode_id = $treenode_id
    AND connector_id = $connector_id
    AND project_id = $project_id
    AND relation_id = $direction_relation_id
EOSQL
                            );
                        if (count($check_result) < 1) {
                            // Then actually insert it:
                            $db->getResult(<<<EOSQL
INSERT INTO treenode_connector
  (project_id, user_id, treenode_id, connector_id, relation_id)
  VALUES ($project_id, $user_id, $treenode_id, $connector_id, $direction_relation_id)
EOSQL
                                );
                        }
                    }
                }
            }

		} catch( Exception $e ) {
			if ($ignoreErrors) {
				error_log("Ignoring the failed migration: ".$e);
				$db->getResult("ROLLBACK TO SAVEPOINT connector_migration");
			} else {
				error_log("The migration failed: ".$e);
				throw $e;
			}
		}
    }
}

class MigrateUsersToDjangoAuthUser {
    var $name = 'Migrate user from user to auth_user';

    function apply( $db, $ignoreErrors) {
        try {
            error_log("Running the migration: ".$this->name);
            $db->getResult("SAVEPOINT migrate_users");

            foreach( $db->getResult('SELECT * FROM "user"') as $p ) {

                $user_id = $p['id'];
                $username = $p['name'];
                $pwd = $p['pwd'];
                $longname = $p['longname'];
                // dummy password to overwrite
                $password = 'pbkdf2_sha256$10000$sBbzKfMBmGZD$+PR/24axXSQ22kdX8TUh9LGZxfmD4ZfeYxbOOXB+lfE=';
                $db->getResult("
INSERT INTO auth_user
  (id, username, first_name, last_name, password, email, is_staff, is_active, is_superuser, last_login, date_joined)
  VALUES (".$user_id.", '".$username."', 'FirstName', 'Lastname', '".$password."', 'mail@mail.com', true, true, false, NOW(), NOW())
"
                                );
            }

		} catch( Exception $e ) {
			if ($ignoreErrors) {
				error_log("Ignoring the failed migration: ".$e);
				$db->getResult("ROLLBACK TO SAVEPOINT migrate_users");
			} else {
				error_log("The migration failed: ".$e);
				throw $e;
			}
		}
    }


}

/* This is another non-trivial migration, which adds the skeleton_id
 * column to the treenode table, and also populates that column */

class AddSkeletonIDsMigration {
    var $name = "Add skeleton_id column to treenode and populate it";
    function apply( $db, $ignoreErrors) {
        try {
            error_log("Running the migration: ".$this->name);
            $db->getResult("SAVEPOINT add_skeleton_column");

            try {
                $db->getResult("ALTER TABLE treenode ADD COLUMN skeleton_id bigint REFERENCES class_instance(id)");
            } catch( Exception $e ) {
                error_log("Ignoring the failure to add a skeleton_id column to treenode; it's probably already there.");
                $db->getResult("ROLLBACK TO SAVEPOINT add_skeleton_column");
            }

            $db->getResult("SAVEPOINT update_skeleton_columns");

            foreach( $db->getResult("SELECT id FROM project") as $p ) {
                $project_id = $p['id'];
                error_log("Dealing with project: ".$project_id);

                // Get a maps of all the class / relation names to IDs
                // for this project:
                $relations = $db->getMap( $project_id, 'relation' );
                $classes = $db->getMap( $project_id, 'class' );

                if (!isset($relations['element_of'])) {
                    // Then this project probably isn't set up for tracing
                    continue;
                }

                $result = $db->getResult(
"UPDATE treenode SET skeleton_id = found.skeleton_id
   FROM (SELECT treenode_id, class_instance_id as skeleton_id
           FROM treenode_class_instance, class_instance
          WHERE treenode_class_instance.project_id = $project_id AND
                treenode_class_instance.relation_id = {$relations['element_of']} AND
                treenode_class_instance.class_instance_id = class_instance.id AND
                class_instance.class_id = {$classes['skeleton']}) AS found
   WHERE treenode.id = found.treenode_id");
                error_log("result was: ".print_r($result, TRUE));
                if ($result === FALSE) {
                    throw new Exception("Setting the skeleton_id column failed");
                }
            }

		} catch( Exception $e ) {
			if ($ignoreErrors) {
				error_log("Ignoring the failed migration: ".$e);
				$db->getResult("ROLLBACK TO SAVEPOINT update_skeleton_columns");
			} else {
				error_log("The migration failed: ".$e);
				throw $e;
			}
		}
    }
}

/* This is another non-trivial migration, similar to AddSkeletonIDsMigration
 * which adds the skeleton_id column to the treenode_connector table,
 * and also populates that column */

class AddSkeletonIDsTreenodeConnectorMigration {
    var $name = "Add skeleton_id column to treenode_connector and populate it";
    function apply( $db, $ignoreErrors) {
        try {
            error_log("Running the migration: ".$this->name);
            $db->getResult("SAVEPOINT add_skeleton_column");

            try {
                $db->getResult("ALTER TABLE treenode_connector ADD COLUMN skeleton_id bigint REFERENCES class_instance(id)");
            } catch( Exception $e ) {
                error_log("Ignoring the failure to add a skeleton_id column to treenode_connector; it's probably already there.");
                $db->getResult("ROLLBACK TO SAVEPOINT add_skeleton_column");
            }

            $db->getResult("SAVEPOINT update_skeleton_columns");

            foreach( $db->getResult("SELECT id FROM project") as $p ) {
                $project_id = $p['id'];
                error_log("Dealing with project: ".$project_id);

                // Get a maps of all the class / relation names to IDs
                // for this project:
                $relations = $db->getMap( $project_id, 'relation' );
                $classes = $db->getMap( $project_id, 'class' );

                if (!isset($relations['element_of'])) {
                    // Then this project probably isn't set up for tracing
                    continue;
                }

                $result = $db->getResult(
"UPDATE treenode_connector SET skeleton_id = found.skeleton_id
   FROM (SELECT treenode_id, class_instance_id as skeleton_id
           FROM treenode_class_instance, class_instance
          WHERE treenode_class_instance.project_id = $project_id AND
                treenode_class_instance.relation_id = {$relations['element_of']} AND
                treenode_class_instance.class_instance_id = class_instance.id AND
                class_instance.class_id = {$classes['skeleton']}) AS found
   WHERE treenode_connector.treenode_id = found.treenode_id");
                error_log("result was: ".print_r($result, TRUE));
                if ($result === FALSE) {
                    throw new Exception("Setting the skeleton_id column failed");
                }
            }

		} catch( Exception $e ) {
			if ($ignoreErrors) {
				error_log("Ignoring the failed migration: ".$e);
				$db->getResult("ROLLBACK TO SAVEPOINT update_skeleton_columns");
			} else {
				error_log("The migration failed: ".$e);
				throw $e;
			}
		}
    }
}

/*
 * This migration removes the presynaptic terminal, postsynaptic terminal and synapse
 * class_instances and their associated relationships
 */
class SimplifyAnnotationDomain {
  var $name = "Remove presynaptic terminal, postsynaptic terminal and synapse from annotation domain";
  function apply( $db, $ignoreErrors) {
    try {
      error_log("Running the migration: ".$this->name);
      $db->getResult("SAVEPOINT simplify_annotation");

      foreach( $db->getResult("SELECT id FROM project") as $p ) {
        $project_id = $p['id'];
        error_log("Dealing with project: ".$project_id);

        // Get a maps of all the class / relation names to IDs
        // for this project:
        $relations = $db->getMap( $project_id, 'relation' );
        $classes = $db->getMap( $project_id, 'class' );

        if (!isset($classes['synapse'])) {
          // Then this project probably isn't set up for tracing
          continue;
        }

        $result = $db->getResult(
          "DELETE FROM class_instance
          WHERE class_instance.project_id = $project_id AND
          class_instance.class_id = {$classes['synapse']}");

        error_log("result was: ".print_r($result, TRUE));
        if ($result === FALSE) {
          throw new Exception("Removing the synapses failed failed");
        }

        $result = $db->getResult(
          "DELETE FROM class_instance
          WHERE class_instance.project_id = $project_id AND
          class_instance.class_id = {$classes['presynaptic terminal']}");

        error_log("result was: ".print_r($result, TRUE));
        if ($result === FALSE) {
          throw new Exception("Removing the presynaptic terminals failed failed");
        }

        $result = $db->getResult(
          "DELETE FROM class_instance
          WHERE class_instance.project_id = $project_id AND
          class_instance.class_id = {$classes['postsynaptic terminal']}");

        error_log("result was: ".print_r($result, TRUE));
        if ($result === FALSE) {
          throw new Exception("Removing the postsynaptic terminals failed failed");
        }

        $result = $db->getResult(
          "DELETE FROM class
          WHERE class.project_id = $project_id AND
          (class.id = {$classes['synapse']} OR
          class.id = {$classes['presynaptic terminal']} OR
          class.id = {$classes['postsynaptic terminal']})");

        error_log("result was: ".print_r($result, TRUE));
        if ($result === FALSE) {
          throw new Exception("Removing the classes failed failed");
        }

      }

    } catch( Exception $e ) {
      if ($ignoreErrors) {
        error_log("Ignoring the failed migration: ".$e);
        $db->getResult("ROLLBACK TO SAVEPOINT simplify_annotation");
      } else {
        error_log("The migration failed: ".$e);
        throw $e;
      }
    }
  }
}


// timestamps must be UTC and in the format
// generated by PHP with:
//	$d = gmdate('Y-m-d\TH:i:s', time());

$migrations = array(

	'2011-07-10T19:23:39' => new Migration(
		'Set up the database as scratch as in 5145c06574a2e',
		"
SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = off;
SET check_function_bodies = false;
SET client_min_messages = warning;
SET escape_string_warning = off;
SET search_path = public, pg_catalog;
CREATE TYPE double3d AS (
	x double precision,
	y double precision,
	z double precision
);
CREATE TYPE integer3d AS (
	x integer,
	y integer,
	z integer
);
CREATE TYPE rgba AS (
	r real,
	g real,
	b real,
	a real
);
CREATE FUNCTION on_edit() RETURNS trigger
    LANGUAGE plpgsql
    AS \$\$BEGIN
    NEW.\"edition_time\" := now();
    RETURN NEW;
END;
\$\$;
SET default_with_oids = false;
CREATE TABLE bezierkey (
    key point NOT NULL,
    before point,
    after point,
    profile_id integer
);
COMMENT ON COLUMN bezierkey.key IS 'nanometer';
CREATE TABLE profile (
    id integer NOT NULL,
    z double precision NOT NULL,
    object_id integer
);
CREATE SEQUENCE profile_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
ALTER SEQUENCE profile_id_seq OWNED BY profile.id;
CREATE TABLE bezierprofile (
)
INHERITS (profile);
CREATE TABLE broken_slice (
    stack_id integer NOT NULL,
    index integer NOT NULL
);
CREATE TABLE concept (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    creation_time timestamp with time zone DEFAULT now() NOT NULL,
    edition_time timestamp with time zone DEFAULT now() NOT NULL,
    project_id bigint NOT NULL
);
CREATE SEQUENCE concept_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
ALTER SEQUENCE concept_id_seq OWNED BY concept.id;
CREATE TABLE class (
    class_name character varying(255) NOT NULL,
    uri character varying(2048),
    description text,
    showintree boolean DEFAULT true
)
INHERITS (concept);
COMMENT ON COLUMN class.showintree IS 'does the element appear in the class tree widget?';
CREATE TABLE relation_instance (
    relation_id bigint NOT NULL
)
INHERITS (concept);
COMMENT ON TABLE relation_instance IS 'despite the table names, it is an abstract table only used for inheritance';
CREATE TABLE class_class (
    class_a bigint,
    class_b bigint
)
INHERITS (relation_instance);
COMMENT ON TABLE class_class IS 'relates two classes';
CREATE TABLE class_instance (
    class_id bigint NOT NULL,
    name character varying(255) NOT NULL
)
INHERITS (concept);
CREATE TABLE class_instance_class_instance (
    class_instance_a bigint,
    class_instance_b bigint
)
INHERITS (relation_instance);
COMMENT ON TABLE class_instance_class_instance IS 'relates two class_instances';
CREATE TABLE location (
    location double3d NOT NULL
)
INHERITS (concept);
CREATE TABLE connector (
    confidence integer DEFAULT 5 NOT NULL
)
INHERITS (location);
CREATE TABLE connector_class_instance (
    connector_id bigint NOT NULL,
    class_instance_id bigint NOT NULL
)
INHERITS (relation_instance);
CREATE TABLE message (
    id integer NOT NULL,
    user_id integer NOT NULL,
    \"time\" timestamp with time zone DEFAULT now() NOT NULL,
    read boolean DEFAULT false NOT NULL,
    title text DEFAULT 'New message'::text NOT NULL,
    text text,
    action text
);
COMMENT ON COLUMN message.action IS 'URL to be executed (remember that this is not safe against man in the middle when not encrypted)';
CREATE SEQUENCE message_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
ALTER SEQUENCE message_id_seq OWNED BY message.id;
CREATE TABLE object (
    id integer NOT NULL,
    class character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    project_id integer NOT NULL,
    colour rgba DEFAULT ROW((1)::real, (0.5)::real, (0)::real, (0.75)::real) NOT NULL
);
CREATE SEQUENCE object_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
ALTER SEQUENCE object_id_seq OWNED BY object.id;
CREATE TABLE project_stack (
    project_id integer NOT NULL,
    stack_id integer NOT NULL,
    translation double3d DEFAULT ROW((0)::double precision, (0)::double precision, (0)::double precision) NOT NULL
);
COMMENT ON COLUMN project_stack.translation IS 'nanometer';
CREATE TABLE project_user (
    project_id integer NOT NULL,
    user_id integer NOT NULL
);
CREATE TABLE relation (
    relation_name character varying(255) NOT NULL,
    uri text,
    description text,
    isreciprocal boolean DEFAULT false NOT NULL
)
INHERITS (concept);
COMMENT ON COLUMN relation.isreciprocal IS 'Is the converse of the relationship valid?';
CREATE TABLE stack (
    id integer NOT NULL,
    title text NOT NULL,
    dimension integer3d NOT NULL,
    resolution double3d NOT NULL,
    image_base text NOT NULL,
    comment text,
    trakem2_project boolean DEFAULT false NOT NULL
);
COMMENT ON COLUMN stack.dimension IS 'pixel';
COMMENT ON COLUMN stack.resolution IS 'nanometer per pixel';
COMMENT ON COLUMN stack.image_base IS 'base URL to the images';
COMMENT ON COLUMN stack.trakem2_project IS 'States if a TrakEM2 project file is available for this stack.';
CREATE SEQUENCE stack_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
ALTER SEQUENCE stack_id_seq OWNED BY stack.id;
CREATE TABLE textlabel (
    id integer NOT NULL,
    type character varying(32) NOT NULL,
    text text DEFAULT 'Edit this text ...'::text NOT NULL,
    colour rgba DEFAULT ROW((1)::real, (0.5)::real, (0)::real, (1)::real) NOT NULL,
    font_name text,
    font_style text,
    font_size double precision DEFAULT 32 NOT NULL,
    project_id integer NOT NULL,
    scaling boolean DEFAULT true NOT NULL,
    creation_time timestamp with time zone DEFAULT now() NOT NULL,
    edition_time timestamp with time zone DEFAULT now() NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    CONSTRAINT textlabel_type_check CHECK ((((type)::text = 'text'::text) OR ((type)::text = 'bubble'::text)))
);
CREATE SEQUENCE textlabel_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
ALTER SEQUENCE textlabel_id_seq OWNED BY textlabel.id;
CREATE TABLE textlabel_location (
    textlabel_id integer NOT NULL,
    location double3d NOT NULL,
    deleted boolean DEFAULT false NOT NULL
);
CREATE TABLE treenode (
    parent_id bigint,
    radius double precision DEFAULT 0 NOT NULL,
    confidence integer DEFAULT 5 NOT NULL
)
INHERITS (location);
CREATE TABLE treenode_class_instance (
    treenode_id bigint NOT NULL,
    class_instance_id bigint NOT NULL
)
INHERITS (relation_instance);
CREATE TABLE treenode_connector (
    treenode_id bigint NOT NULL,
    connector_id bigint NOT NULL
)
INHERITS (relation_instance);
CREATE TABLE \"user\" (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    pwd character varying(255) NOT NULL,
    longname text
);
CREATE SEQUENCE user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
ALTER SEQUENCE user_id_seq OWNED BY \"user\".id;
ALTER TABLE concept ALTER COLUMN id SET DEFAULT nextval('concept_id_seq'::regclass);
ALTER TABLE message ALTER COLUMN id SET DEFAULT nextval('message_id_seq'::regclass);
ALTER TABLE object ALTER COLUMN id SET DEFAULT nextval('object_id_seq'::regclass);
ALTER TABLE profile ALTER COLUMN id SET DEFAULT nextval('profile_id_seq'::regclass);
ALTER TABLE stack ALTER COLUMN id SET DEFAULT nextval('stack_id_seq'::regclass);
ALTER TABLE textlabel ALTER COLUMN id SET DEFAULT nextval('textlabel_id_seq'::regclass);
ALTER TABLE \"user\" ALTER COLUMN id SET DEFAULT nextval('user_id_seq'::regclass);
ALTER TABLE ONLY broken_slice
    ADD CONSTRAINT broken_layer_pkey PRIMARY KEY (stack_id, index);
ALTER TABLE ONLY class
    ADD CONSTRAINT class_id_key UNIQUE (id);
ALTER TABLE ONLY class_instance
    ADD CONSTRAINT class_instance_id_key UNIQUE (id);
ALTER TABLE ONLY class_instance
    ADD CONSTRAINT class_instance_pkey PRIMARY KEY (id);
ALTER TABLE ONLY class_instance_class_instance
    ADD CONSTRAINT class_instance_relation_instance_id_key UNIQUE (id);
ALTER TABLE ONLY class_instance_class_instance
    ADD CONSTRAINT class_instance_relation_instance_pkey PRIMARY KEY (id);
ALTER TABLE ONLY class
    ADD CONSTRAINT class_pkey PRIMARY KEY (id);
ALTER TABLE ONLY class_class
    ADD CONSTRAINT class_relation_instance_id_key UNIQUE (id);
ALTER TABLE ONLY class_class
    ADD CONSTRAINT class_relation_instance_pkey PRIMARY KEY (id);
ALTER TABLE ONLY concept
    ADD CONSTRAINT concept_id_key UNIQUE (id);
ALTER TABLE ONLY concept
    ADD CONSTRAINT concept_pkey PRIMARY KEY (id);
ALTER TABLE ONLY connector_class_instance
    ADD CONSTRAINT connector_class_instance_id_key UNIQUE (id);
ALTER TABLE ONLY connector_class_instance
    ADD CONSTRAINT connector_class_instance_pkey PRIMARY KEY (id);
ALTER TABLE ONLY connector
    ADD CONSTRAINT connector_id_key UNIQUE (id);
ALTER TABLE ONLY connector
    ADD CONSTRAINT connector_pkey PRIMARY KEY (id);
ALTER TABLE ONLY location
    ADD CONSTRAINT location_id_key UNIQUE (id);
ALTER TABLE ONLY location
    ADD CONSTRAINT location_pkey PRIMARY KEY (id);
ALTER TABLE ONLY message
    ADD CONSTRAINT message_pkey PRIMARY KEY (id);
ALTER TABLE ONLY object
    ADD CONSTRAINT object_id_key UNIQUE (id);
ALTER TABLE ONLY object
    ADD CONSTRAINT object_pkey PRIMARY KEY (class, name);
ALTER TABLE ONLY profile
    ADD CONSTRAINT profile_pkey PRIMARY KEY (id);
ALTER TABLE ONLY project_stack
    ADD CONSTRAINT project_stack_pkey PRIMARY KEY (project_id, stack_id);
ALTER TABLE ONLY project_user
    ADD CONSTRAINT project_user_pkey PRIMARY KEY (project_id, user_id);
ALTER TABLE ONLY relation
    ADD CONSTRAINT relation_id_key UNIQUE (id);
ALTER TABLE ONLY relation_instance
    ADD CONSTRAINT relation_instance_id_key UNIQUE (id);
ALTER TABLE ONLY relation_instance
    ADD CONSTRAINT relation_instance_pkey PRIMARY KEY (id);
ALTER TABLE ONLY relation
    ADD CONSTRAINT relation_pkey PRIMARY KEY (id);
ALTER TABLE ONLY stack
    ADD CONSTRAINT stack_pkey PRIMARY KEY (id);
ALTER TABLE ONLY textlabel
    ADD CONSTRAINT textlabel_pkey PRIMARY KEY (id);
ALTER TABLE ONLY treenode_class_instance
    ADD CONSTRAINT treenode_class_instance_id_key UNIQUE (id);
ALTER TABLE ONLY treenode_class_instance
    ADD CONSTRAINT treenode_class_instance_pkey PRIMARY KEY (id);
ALTER TABLE ONLY treenode
    ADD CONSTRAINT treenode_id_key UNIQUE (id);
ALTER TABLE ONLY treenode
    ADD CONSTRAINT treenode_pkey PRIMARY KEY (id);
ALTER TABLE ONLY \"user\"
    ADD CONSTRAINT users_name_key UNIQUE (name);
ALTER TABLE ONLY \"user\"
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
CREATE INDEX connector_x_index ON connector USING btree (((location).x));
CREATE INDEX connector_y_index ON connector USING btree (((location).y));
CREATE INDEX connector_z_index ON connector USING btree (((location).z));
CREATE INDEX location_x_index ON treenode USING btree (((location).x));
CREATE INDEX location_y_index ON treenode USING btree (((location).y));
CREATE INDEX location_z_index ON treenode USING btree (((location).z));
CREATE TRIGGER apply_edition_time_update
    BEFORE UPDATE ON class_instance
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit
    BEFORE UPDATE ON textlabel
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit
    BEFORE UPDATE ON concept
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_bezierprofile
    BEFORE UPDATE ON bezierprofile
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_class
    BEFORE UPDATE ON class
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_class_class
    BEFORE UPDATE ON class_class
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_class_instance
    BEFORE UPDATE ON class_instance
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_class_instance_class_instance
    BEFORE UPDATE ON class_instance_class_instance
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_connector
    BEFORE UPDATE ON connector
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_connector_class_instance
    BEFORE UPDATE ON connector_class_instance
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_location
    BEFORE UPDATE ON location
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_relation
    BEFORE UPDATE ON relation
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_relation_instance
    BEFORE UPDATE ON relation_instance
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_treenode
    BEFORE UPDATE ON treenode
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_treenode_class_instance
    BEFORE UPDATE ON treenode_class_instance
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
CREATE TRIGGER on_edit_treenode_connector
    BEFORE UPDATE ON treenode_connector
    FOR EACH ROW
    EXECUTE PROCEDURE on_edit();
ALTER TABLE ONLY bezierkey
    ADD CONSTRAINT bezierkey_profile_fkey FOREIGN KEY (profile_id) REFERENCES profile(id);
ALTER TABLE ONLY broken_slice
    ADD CONSTRAINT broken_layer_stack_id_fkey FOREIGN KEY (stack_id) REFERENCES stack(id);
ALTER TABLE ONLY class_class
    ADD CONSTRAINT class_class_class_a_fkey FOREIGN KEY (class_a) REFERENCES class(id) ON DELETE CASCADE;
ALTER TABLE ONLY class_class
    ADD CONSTRAINT class_class_class_b_fkey FOREIGN KEY (class_b) REFERENCES class(id) ON DELETE CASCADE;
ALTER TABLE ONLY class_instance
    ADD CONSTRAINT class_instance_class_id_fkey FOREIGN KEY (class_id) REFERENCES class(id);
ALTER TABLE ONLY class_instance_class_instance
    ADD CONSTRAINT class_instance_class_instance_class_instance_a_fkey FOREIGN KEY (class_instance_a) REFERENCES class_instance(id) ON DELETE CASCADE;
ALTER TABLE ONLY class_instance_class_instance
    ADD CONSTRAINT class_instance_class_instance_class_instance_b_fkey FOREIGN KEY (class_instance_b) REFERENCES class_instance(id) ON DELETE CASCADE;
ALTER TABLE ONLY class_instance_class_instance
    ADD CONSTRAINT class_instance_relation_instance_relation_id_fkey FOREIGN KEY (relation_id) REFERENCES relation(id);
ALTER TABLE ONLY class_instance_class_instance
    ADD CONSTRAINT class_instance_relation_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY class_instance
    ADD CONSTRAINT class_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY class_class
    ADD CONSTRAINT class_relation_instance_relation_id_fkey FOREIGN KEY (relation_id) REFERENCES relation(id);
ALTER TABLE ONLY class_class
    ADD CONSTRAINT class_relation_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY class
    ADD CONSTRAINT class_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY concept
    ADD CONSTRAINT concept_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY connector_class_instance
    ADD CONSTRAINT connector_class_instance_class_instance_id_fkey FOREIGN KEY (class_instance_id) REFERENCES class_instance(id);
ALTER TABLE ONLY connector_class_instance
    ADD CONSTRAINT connector_class_instance_location_id_fkey FOREIGN KEY (connector_id) REFERENCES connector(id) ON DELETE CASCADE;
ALTER TABLE ONLY connector_class_instance
    ADD CONSTRAINT connector_class_instance_project_id_fkey FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE ONLY connector_class_instance
    ADD CONSTRAINT connector_class_instance_relation_id_fkey FOREIGN KEY (relation_id) REFERENCES relation(id);
ALTER TABLE ONLY connector_class_instance
    ADD CONSTRAINT connector_class_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY message
    ADD CONSTRAINT message_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY object
    ADD CONSTRAINT object_project_fkey FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE ONLY profile
    ADD CONSTRAINT profile_object_fkey FOREIGN KEY (object_id) REFERENCES object(id);
ALTER TABLE ONLY project_stack
    ADD CONSTRAINT project_stack_project_id_fkey FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE ONLY project_stack
    ADD CONSTRAINT project_stack_stack_id_fkey FOREIGN KEY (stack_id) REFERENCES stack(id);
ALTER TABLE ONLY project_user
    ADD CONSTRAINT project_user_project_id_fkey FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE ONLY project_user
    ADD CONSTRAINT project_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY relation_instance
    ADD CONSTRAINT relation_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY relation
    ADD CONSTRAINT relation_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY textlabel_location
    ADD CONSTRAINT textlabel_location_textlabel_id_fkey FOREIGN KEY (textlabel_id) REFERENCES textlabel(id);
ALTER TABLE ONLY textlabel
    ADD CONSTRAINT textlabel_project_id_fkey FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE ONLY treenode_class_instance
    ADD CONSTRAINT treenode_class_instance_class_instance_id_fkey FOREIGN KEY (class_instance_id) REFERENCES class_instance(id) ON DELETE CASCADE;
ALTER TABLE ONLY treenode_class_instance
    ADD CONSTRAINT treenode_class_instance_relation_id_fkey FOREIGN KEY (relation_id) REFERENCES relation(id);
ALTER TABLE ONLY treenode_class_instance
    ADD CONSTRAINT treenode_class_instance_treenode_id_fkey FOREIGN KEY (treenode_id) REFERENCES treenode(id) ON DELETE CASCADE;
ALTER TABLE ONLY treenode_class_instance
    ADD CONSTRAINT treenode_class_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY treenode
    ADD CONSTRAINT treenode_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES treenode(id);
"
),

	'2011-07-12T17:22:30' => new Migration(
		'Remove unused table. Closes #79',
		'
DROP TABLE "bezierkey" CASCADE;
DROP TABLE "bezierprofile" CASCADE;
DROP TABLE "broken_slice" CASCADE;
DROP TABLE "object" CASCADE;
DROP TABLE "profile" CASCADE;
'
),

	'2011-07-12T17:30:44' => new Migration(
		'Removed unused columns from class table. Closes #83',
		'
ALTER TABLE "class" DROP COLUMN "showintree";
ALTER TABLE "class" DROP COLUMN "uri";
'
),

	'2011-07-12T19:48:11' => new Migration(
		'Create table broken_slice',
		'CREATE TABLE broken_slice (stack_id integer NOT NULL, index integer NOT NULL)'
),

	'2011-10-19T08:33:49' => new Migration(
		'Introduce a sessions table for storing PHP sessions',
		"CREATE TABLE sessions (id SERIAL PRIMARY KEY, session_id CHAR(26), data TEXT DEFAULT '', last_accessed TIMESTAMP)"
),

	'2011-10-20T15:14:59' => new Migration(
		'Switch to tracking exactly which migrations have been applied',
		'CREATE TABLE applied_migrations (id VARCHAR(32) PRIMARY KEY)'
),

	'2011-10-30T16:10:19' => new SpecialConnectorMigration(),

	'2011-11-23T10:18:23' => new AddSkeletonIDsMigration(),

	'2011-11-24T14:35:19' => new Migration(
		'Adding overlay table',
		<<<EOMIGRATION
CREATE TABLE "overlay" (
    id integer NOT NULL,
    stack_id integer NOT NULL,
    title text NOT NULL,
    image_base text NOT NULL,
    default_opacity integer DEFAULT 0 NOT NULL
);
CREATE SEQUENCE overlay_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
ALTER SEQUENCE overlay_id_seq OWNED BY "overlay".id;
ALTER TABLE ONLY "overlay"
    ADD CONSTRAINT overlay_pkey PRIMARY KEY (id);
ALTER TABLE ONLY "overlay"
    ADD CONSTRAINT overlay_stack_id_fkey FOREIGN KEY (stack_id) REFERENCES stack(id) ON DELETE CASCADE;
ALTER TABLE "overlay" ALTER COLUMN id SET DEFAULT nextval('overlay_id_seq'::regclass);
EOMIGRATION
		,
		TRUE
),

    '2011-12-13T17:21:03' => new Migration(
        'Add minimum zoom level information to stack table',
        'ALTER TABLE stack ADD COLUMN min_zoom_level integer;
         UPDATE stack SET min_zoom_level = -1;
         ALTER TABLE stack ALTER COLUMN min_zoom_level SET NOT NULL;'
),

	'2011-12-14T13:42:27' => new Migration(
		'Set a default for the min_zoom_level column of stack',
		'ALTER TABLE stack ALTER COLUMN min_zoom_level SET DEFAULT -1;'
),

    '2011-12-14T18:42:00' => new Migration(
        'Add file extension information to stacks and overlays',
        "ALTER TABLE stack ADD COLUMN file_extension text;
         ALTER TABLE overlay ADD COLUMN file_extension text;
         UPDATE stack SET file_extension = 'jpg';
         UPDATE overlay SET file_extension = 'jpg';
         ALTER TABLE stack ALTER COLUMN file_extension SET NOT NULL;
         ALTER TABLE overlay ALTER COLUMN file_extension SET NOT NULL;"
),

	'2011-12-20T13:42:27' => new Migration(
		'Set file name extension to JPG by default',
		"ALTER TABLE stack ALTER COLUMN file_extension SET DEFAULT 'jpg';"
),

	'2011-12-12T10:18:23' => new AddSkeletonIDsTreenodeConnectorMigration(),


	'2011-12-27T12:51:12' => new Migration(
		'Update containts in treenode_connector',
		'
ALTER TABLE treenode_connector DROP CONSTRAINT treenode_connector_skeleton_id_fkey;
ALTER TABLE ONLY treenode_connector
    ADD CONSTRAINT treenode_connector_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES connector(id) ON DELETE CASCADE;
ALTER TABLE ONLY treenode_connector
    ADD CONSTRAINT treenode_connector_skeleton_id_fkey FOREIGN KEY (skeleton_id) REFERENCES class_instance(id) ON DELETE CASCADE;
ALTER TABLE ONLY treenode_connector
    ADD CONSTRAINT treenode_connector_treenode_id_fkey FOREIGN KEY (treenode_id) REFERENCES treenode(id) ON DELETE CASCADE;
ALTER TABLE ONLY treenode_connector
    ADD CONSTRAINT treenode_connector_user_id_fkey FOREIGN KEY (user_id) REFERENCES "user"(id);
'
),

	'2012-01-15T14:45:48' => new Migration(
		'Add a confidence measure to treenode_connector',
		'ALTER TABLE ONLY treenode_connector
			ADD COLUMN confidence integer NOT NULL DEFAULT 5'),

	'2012-02-07T15:50:32' => new Migration(
		'Fix missing ON delete cascade',
		'
ALTER TABLE connector_class_instance DROP CONSTRAINT connector_class_instance_class_instance_id_fkey;
ALTER TABLE ONLY connector_class_instance
    ADD CONSTRAINT connector_class_instance_class_instance_id_fkey FOREIGN KEY (class_instance_id) REFERENCES class_instance(id) ON DELETE CASCADE;
ALTER TABLE treenode DROP CONSTRAINT treenode_skeleton_id_fkey;
ALTER TABLE ONLY treenode
    ADD CONSTRAINT treenode_skeleton_id_fkey FOREIGN KEY (skeleton_id) REFERENCES class_instance(id) ON DELETE CASCADE;
'
),

	'2012-02-14T08:46:38' => new Migration(
		'Tile size as stack table field',
		'
ALTER TABLE stack ADD COLUMN tile_width integer NOT NULL DEFAULT 256;
ALTER TABLE stack ADD COLUMN tile_height integer NOT NULL DEFAULT 256;
'
),

  '2012-02-14T14:32:05' => new Migration(
    'Data source type specification.',
    '
ALTER TABLE stack DROP COLUMN IF EXISTS tile_source_type;
ALTER TABLE overlay DROP COLUMN IF EXISTS tile_source_type;
ALTER TABLE stack ADD COLUMN tile_source_type integer NOT NULL DEFAULT 1;
'
  ),


    // Make the default of these permissions restrictive (i.e. can't
    // do anything) for the future but set them both to TRUE for
    // existing entries, since the previous behaviour was to allow
    // viewing and editing for all users in this table.

	'2012-02-27T13:10:42' => new Migration(
		'Add can_edit_any and can_view_any permissions to the project_user table',
		'
ALTER TABLE project_user ADD COLUMN can_edit_any boolean DEFAULT FALSE;
ALTER TABLE project_user ADD COLUMN can_view_any boolean DEFAULT FALSE;
UPDATE project_user SET can_edit_any = TRUE;
UPDATE project_user SET can_view_any = TRUE;
'
),

    '2012-03-08T10:00:16' => new Migration(
        'Rename min_zoom_level field to num_zoom_levels in stacks table',
		'ALTER TABLE stack RENAME COLUMN min_zoom_level TO num_zoom_levels;'
),

	'2012-03-22T20:16:56' => new Migration(
		'Add log table',
		'
CREATE TABLE log (
    operation_type character varying(255) NOT NULL,
    location double3d,
    freetext text
    )
INHERITS (concept);
ALTER TABLE ONLY log
    ADD CONSTRAINT log_pkey PRIMARY KEY (id);

'
),

	'2012-03-25 T01:26:02' => new Migration(
		'Reviewer columns in location, thus treenode and connector, table',
		'
ALTER TABLE location ADD COLUMN reviewer_id integer NOT NULL DEFAULT -1;
ALTER TABLE location ADD COLUMN review_time timestamp with time zone DEFAULT NULL;
'
),

  '2012-03-30T15:56:17' => new SimplifyAnnotationDomain(),

// Help: http://blog.enricostahn.com/2010/06/11/postgresql-add-primary-key-to-an-existing-table.html
	'2012-04-06T16:06:41' => new Migration(
  'Add primary id column to project_stack preparation',
  '
ALTER TABLE project_stack DROP CONSTRAINT "project_stack_pkey";
ALTER TABLE project_stack ADD COLUMN id INTEGER;
CREATE SEQUENCE "project_stack_id_seq";
'
),

	'2012-04-06T16:07:41' => new Migration(
		'Add primary id column to project_stack',
		"
UPDATE project_stack SET id = nextval('project_stack_id_seq');
ALTER TABLE project_stack
  ALTER COLUMN id SET DEFAULT nextval('project_stack_id_seq');
ALTER TABLE project_stack ALTER COLUMN id SET NOT NULL;
ALTER TABLE project_stack ADD UNIQUE (id);
ALTER TABLE project_stack DROP CONSTRAINT project_stack_id_key RESTRICT;
ALTER TABLE project_stack ADD PRIMARY KEY (id);
"
),

  '2012-04-06T18:06:41' => new Migration(
    'Add primary id column to broken_slice preparation',
    '
ALTER TABLE broken_slice ADD COLUMN id INTEGER;
CREATE SEQUENCE "broken_slice_id_seq";
'
  ),

  '2012-04-06T18:07:41' => new Migration(
    'Add primary id column to broken_slice',
    "
UPDATE broken_slice SET id = nextval('broken_slice_id_seq');
ALTER TABLE broken_slice
  ALTER COLUMN id SET DEFAULT nextval('broken_slice_id_seq');
ALTER TABLE broken_slice ALTER COLUMN id SET NOT NULL;
ALTER TABLE broken_slice ADD UNIQUE (id);
ALTER TABLE broken_slice DROP CONSTRAINT broken_slice_id_key RESTRICT;
ALTER TABLE broken_slice ADD PRIMARY KEY (id);
"
  ),

	'2012-04-10T10:15:16' => new Migration(
		'Add a metadata field for the stacks',
		"ALTER TABLE stack ADD COLUMN metadata text;
		 UPDATE stack SET metadata = '';
		 ALTER TABLE stack ALTER COLUMN metadata SET DEFAULT '';
		 ALTER TABLE stack ALTER COLUMN metadata SET NOT NULL;"
),


	'2012-05-16T12:20:53' => new Migration(
		'Invert mouse wheel direction column',
		'
ALTER TABLE project_user ADD COLUMN inverse_mouse_wheel boolean DEFAULT FALSE;
'
),

	'2012-07-10T20:43:35' => new Migration(
		'Add id column to textlabel_location (1)',
		'
ALTER TABLE textlabel_location ADD COLUMN id INTEGER;
CREATE SEQUENCE "textlabel_location_id_seq";
'
),

	'2012-07-10T20:44:35' => new Migration(
		'Add id column to textlabel_location (2)',
		"
UPDATE textlabel_location SET id = nextval('textlabel_location_id_seq');
ALTER TABLE textlabel_location
  ALTER COLUMN id SET DEFAULT nextval('textlabel_location_id_seq');
ALTER TABLE textlabel_location ALTER COLUMN id SET NOT NULL;
ALTER TABLE textlabel_location ADD PRIMARY KEY (id);
"
),


	'2012-10-09T14:40:01' => new Migration(
		'Remove some wrong user foreign key constraints',
		'
ALTER TABLE treenode_connector DROP CONSTRAINT IF EXISTS treenode_connector_user_id_fkey;
ALTER TABLE concept DROP CONSTRAINT IF EXISTS concept_user_id_fkey;
ALTER TABLE connector_class_instance DROP CONSTRAINT IF EXISTS connector_class_instance_user_id_fkey;
'
),

	'2012-10-09T21:19:38' => new Migration(
		'Skeletongroup_dashboard',
		'
CREATE TABLE skeletonlist_dashboard (
    shortname character varying(255) NOT NULL,
    skeleton_list int[],
    description text
    )
INHERITS (concept);
ALTER TABLE ONLY skeletonlist_dashboard
    ADD CONSTRAINT skeletonlist_dashboard_pkey PRIMARY KEY (id);
'
),

	'2012-10-10T12:20:53' => new Migration(
		'Create component table',
		"
CREATE TABLE component (
    stack_id bigint NOT NULL,
    skeleton_id bigint NOT NULL,
    component_id bigint NOT NULL,
    min_x bigint NOT NULL,
    min_y bigint NOT NULL,
    max_x bigint NOT NULL,
    max_y bigint NOT NULL,
    z bigint NOT NULL,
    threshold double precision,
    status integer DEFAULT 0 NOT NULL
)
INHERITS (concept);

ALTER TABLE ONLY component ALTER COLUMN id SET DEFAULT nextval('concept_id_seq'::regclass);
ALTER TABLE ONLY component ALTER COLUMN creation_time SET DEFAULT now();
ALTER TABLE ONLY component ALTER COLUMN edition_time SET DEFAULT now();
ALTER TABLE ONLY component ADD CONSTRAINT component_pkey PRIMARY KEY (id);
ALTER TABLE ONLY component ADD CONSTRAINT component_stack_id_fkey FOREIGN KEY (stack_id) REFERENCES stack(id) ON DELETE CASCADE;
ALTER TABLE ONLY component ADD CONSTRAINT component_project_id_fkey FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE;
ALTER TABLE ONLY component ADD CONSTRAINT component_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"auth_user\"(id) ON DELETE CASCADE;

"
),


'2012-10-11T13:21:53' => new Migration(
		'Create drawing table',
		"
CREATE TABLE drawing (
    stack_id bigint NOT NULL,
    z bigint NOT NULL,
    skeleton_id bigint,
    component_id bigint,
    min_x bigint NOT NULL,
    min_y bigint NOT NULL,
    max_x bigint NOT NULL,
    max_y bigint NOT NULL,
    svg text NOT NULL,
    type integer DEFAULT 0 NOT NULL,
    status integer DEFAULT 0 NOT NULL
)
INHERITS (concept);

ALTER TABLE ONLY drawing ALTER COLUMN id SET DEFAULT nextval('concept_id_seq'::regclass);
ALTER TABLE ONLY drawing ALTER COLUMN creation_time SET DEFAULT now();
ALTER TABLE ONLY drawing ALTER COLUMN edition_time SET DEFAULT now();
ALTER TABLE ONLY drawing ADD CONSTRAINT drawing_pkey PRIMARY KEY (id);
ALTER TABLE ONLY drawing ADD CONSTRAINT drawing_stack_id_fkey FOREIGN KEY (stack_id) REFERENCES stack(id) ON DELETE CASCADE;
ALTER TABLE ONLY drawing ADD CONSTRAINT drawing_project_id_fkey FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE;
ALTER TABLE ONLY drawing ADD CONSTRAINT drawing_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"auth_user\"(id) ON DELETE CASCADE;

"
),

	'2012-10-11T14:41:10' => new MigrateUsersToDjangoAuthUser(),

    '2012-10-12T01:00:00' => new Migration(
       'Fix to allow running of migration 2012-10-12T01:41:10 -- reverts 2012-10-09T14:40:01',
       "
ALTER TABLE ONLY concept ADD CONSTRAINT concept_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY connector_class_instance ADD CONSTRAINT connector_class_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
ALTER TABLE ONLY treenode_connector ADD CONSTRAINT treenode_connector_user_id_fkey FOREIGN KEY (user_id) REFERENCES \"user\"(id);
"
),

	'2012-10-12T01:41:10' => new Migration(
		'Use auth_user to identify users',
		'
ALTER TABLE ONLY class_instance_class_instance DROP CONSTRAINT class_instance_relation_instance_user_id_fkey;
ALTER TABLE ONLY class_instance DROP CONSTRAINT class_instance_user_id_fkey;
ALTER TABLE ONLY class_class DROP CONSTRAINT class_relation_instance_user_id_fkey;
ALTER TABLE ONLY class DROP CONSTRAINT class_user_id_fkey;
ALTER TABLE ONLY component DROP CONSTRAINT component_user_id_fkey;
ALTER TABLE ONLY concept DROP CONSTRAINT concept_user_id_fkey;
ALTER TABLE ONLY connector_class_instance DROP CONSTRAINT connector_class_instance_user_id_fkey;
ALTER TABLE ONLY drawing DROP CONSTRAINT drawing_user_id_fkey;
ALTER TABLE ONLY message DROP CONSTRAINT message_user_id_fkey;
ALTER TABLE ONLY project_user DROP CONSTRAINT project_user_user_id_fkey;
ALTER TABLE ONLY relation_instance DROP CONSTRAINT relation_instance_user_id_fkey;
ALTER TABLE ONLY relation DROP CONSTRAINT relation_user_id_fkey;
ALTER TABLE ONLY treenode_class_instance DROP CONSTRAINT treenode_class_instance_user_id_fkey;
ALTER TABLE ONLY treenode_connector DROP CONSTRAINT treenode_connector_user_id_fkey;

ALTER TABLE ONLY class_instance_class_instance ADD CONSTRAINT class_instance_relation_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id);
ALTER TABLE ONLY class_instance ADD CONSTRAINT class_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id);
ALTER TABLE ONLY class_class ADD CONSTRAINT class_relation_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id);
ALTER TABLE ONLY class ADD CONSTRAINT class_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id);
ALTER TABLE ONLY component ADD CONSTRAINT component_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY concept ADD CONSTRAINT concept_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id);
ALTER TABLE ONLY connector_class_instance ADD CONSTRAINT connector_class_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id);
ALTER TABLE ONLY drawing ADD CONSTRAINT drawing_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY message ADD CONSTRAINT message_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id);
ALTER TABLE ONLY project_user ADD CONSTRAINT project_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id);
ALTER TABLE ONLY relation_instance ADD CONSTRAINT relation_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id);
ALTER TABLE ONLY relation ADD CONSTRAINT relation_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id);
ALTER TABLE ONLY treenode_class_instance ADD CONSTRAINT treenode_class_instance_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id);
ALTER TABLE ONLY treenode_connector ADD CONSTRAINT treenode_connector_user_id_fkey FOREIGN KEY (user_id) REFERENCES "auth_user"(id);
'
),

	'2012-10-13T08:46:38' => new Migration(
		'More properties for overlay table',
		'
ALTER TABLE overlay ADD COLUMN tile_width integer NOT NULL DEFAULT 512;
ALTER TABLE overlay ADD COLUMN tile_height integer NOT NULL DEFAULT 512;
ALTER TABLE overlay ADD COLUMN tile_source_type integer NOT NULL DEFAULT 1;
'
),

	'2012-10-29T18:42:05' => new Migration(
		'Add indices to the treenode connector_class_instance',
		'
CREATE INDEX treenode_id_index ON treenode_class_instance USING btree (treenode_id);
CREATE INDEX connector_id_index ON connector_class_instance USING btree (connector_id);
'
),

	'2012-10-29T19:42:05' => new Migration(
		'Add indices to other tables',
		'
CREATE INDEX skeleton_id_treenode_connector_index ON treenode_connector USING btree (skeleton_id);
CREATE INDEX treenode_id_treenode_connector_index ON treenode_connector USING btree (treenode_id);
CREATE INDEX connector_id_treenode_connector_index ON treenode_connector USING btree (connector_id);
CREATE INDEX class_id_ci_index ON class_instance USING btree (class_id);
CREATE INDEX class_instance_a_cici_index ON class_instance_class_instance USING btree (class_instance_a);
CREATE INDEX class_instance_b_cici_index ON class_instance_class_instance USING btree (class_instance_b);
'
),

	'2012-10-30T19:42:05' => new Migration(
		'Add index to treenode table',
		'
CREATE INDEX skeleton_id_treenode_index ON treenode USING btree (skeleton_id);
'
),

	'2012-10-30T20:00:02' => new Migration(
            'Add data view tables',
            "
CREATE TABLE data_view (
id integer NOT NULL,
title text NOT NULL,
data_view_type_id integer NOT NULL,
config text NOT NULL,
is_default boolean DEFAULT false NOT NULL,
position integer DEFAULT 0 NOT NULL,
comment text);
CREATE TABLE data_view_type (
id integer NOT NULL,
title text NOT NULL,
code_type text NOT NULL,
comment text);
CREATE SEQUENCE data_view_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
CREATE SEQUENCE data_view_type_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
ALTER SEQUENCE data_view_id_seq OWNED BY data_view.id;
ALTER SEQUENCE data_view_type_id_seq OWNED BY data_view_type.id;
ALTER TABLE data_view ALTER COLUMN id SET DEFAULT nextval('data_view_id_seq'::regclass);
ALTER TABLE data_view ALTER COLUMN config SET DEFAULT '{}';
ALTER TABLE data_view_type ALTER COLUMN id SET DEFAULT nextval('data_view_type_id_seq'::regclass);
ALTER TABLE ONLY data_view
    ADD CONSTRAINT data_view_pkey PRIMARY KEY (id);
ALTER TABLE ONLY data_view_type
    ADD CONSTRAINT data_view_type_pkey PRIMARY KEY (id);
ALTER TABLE ONLY data_view
    ADD CONSTRAINT data_view_type_id_fkey FOREIGN KEY (data_view_type_id) REFERENCES data_view_type(id);
"
),

    '2012-10-30T21:44:44' => new Migration(
            'Add two list data view types',
            "
INSERT INTO data_view_type
(title, code_type, comment)
VALUES ( 'Legacy project list view', 'legacy_project_list_data_view', 'A simple list of all projects and their stacks. It is rendered in the browser with the help of JavaScript and it does not support any configuration options. The config field of a data view is therefore likely to read only {}.' );
INSERT INTO data_view_type
(title, code_type, comment)
VALUES ( 'Project list view', 'project_list_data_view', 'A simple adjustable list of all projects and their stacks. This view is rendered server side and supports the display of sample images. The following options are available: \"sample_images\": [true|false], \"sample_stack\": [\"first\"|\"last\"], \"sample_slice\": [slice number|\"first\"|\"center\"|\"last\"]. By default projects are sorted. Use \"sort\":false to turn this off. Thus, a valid sample configuration could look like: {\"sample_images\":true,\"sample_stack\":\"last\",\"sample_slice\":\"center\"}' );
"
),
    '2012-10-30T22:01:00' => new Migration(
            'Add a table data view type',
            "
INSERT INTO data_view_type
(title, code_type, comment)
VALUES ( 'Tabular project view', 'project_table_data_view', 'A simple table of all projects and their stacks. This view is rendered server side and supports the display of sample images instead of stack names. The following options are available: \"sample_images\": [true|false], \"sample_slice\": [slice number|\"first\"|\"center\"|\"last\"], \"sort\": [true|false]. By default projects are sorted and displayed without images. A valid configuration could look like: {\"sample_images\":true,\"sample_slice\":\"center\"}' );
"   
),

    '2012-11-05T16:11:11' => new Migration(
            'Add two data views and make one default',
            "
INSERT INTO data_view
(title, data_view_type_id, config, is_default, position, comment)
VALUES ('Project list', (SELECT id FROM data_view_type dvt WHERE dvt.code_type='project_list_data_view'), '{}', false, 0, '');
INSERT INTO data_view
(title, data_view_type_id, config, is_default, position, comment)
VALUES ('Project table with images', (SELECT id FROM data_view_type dvt WHERE dvt.code_type='project_table_data_view'), '{\"sample_images\":true}', true, 1, '');
"
),

	'2012-11-06T22:25:29' => new Migration(
		'Add index for relation_id column in cici table',
		'
CREATE INDEX relation_id_cici_index ON class_instance_class_instance USING btree (relation_id);
'
),

		'2012-11-06T22:24:00' => new Migration(
				'Make treenode.parent_id an index',
				'
CREATE INDEX treenode_parent_id_index ON treenode USING btree (parent_id);
'
),

        '2012-11-13T13:22:22' => new Migration(
                'Extend help text of project list and project table data views',
                "
UPDATE data_view_type
SET comment = 'A simple adjustable list of all projects and their stacks. This view is rendered server side and supports the display of sample images. The following options are available: \"sample_images\": [true|false], \"sample_stack\": [\"first\"|\"last\"], \"sample_slice\": [slice number|\"first\"|\"center\"|\"last\"] and \"sample_scaling\": [scaling percentage]. By default projects are sorted. Use \"sort\":false to turn this off. Thus, a valid sample configuration could look like: {\"sample_images\":true,\"sample_stack\":\"last\",\"sample_slice\":\"center\",\"sample_scaling\":75}'
WHERE code_type = 'project_list_data_view';
UPDATE data_view_type
SET comment = 'A simple table of all projects and their stacks. This view is rendered server side and supports the display of sample images instead of stack names. The following options are available: \"sample_images\": [true|false], \"sample_slice\": [slice number|\"first\"|\"center\"|\"last\"], \"sample_scaling\": [scaling percentage] and  \"sort\": [true|false]. By default projects are sorted and displayed without images. A valid configuration could look like: {\"sample_images\":true,\"sample_slice\":\"center\",\"sample_scaling\":42}'
WHERE code_type = 'project_table_data_view';
"
),

	'2012-11-14T14:36:18' => new Migration(
		'Make broken_slice.stack_id a foreign key if stack.id',
		'
ALTER TABLE ONLY broken_slice
    ADD CONSTRAINT broken_slice_stack_id_fkey FOREIGN KEY (stack_id) REFERENCES stack(id);
'
),

	'2012-11-15T20:36:18' => new Migration(
		'Add editor_id to location table, copying the value of user_id. Will take some time if your location table is large.',
		'
ALTER TABLE location ADD COLUMN editor_id integer;
UPDATE location SET editor_id = user_id;
ALTER TABLE location
	ADD CONSTRAINT editor_id_fkey FOREIGN KEY (editor_id) REFERENCES "auth_user"(id);
'
),

	'2012-11-16T12:01:00' => new Migration(
            'Add a tag data view type',
            "
INSERT INTO data_view_type
(title, code_type, comment)
VALUES ( 'Tag project view', 'project_tags_data_view', 'A table that allows to define tags for the columns and rows. This view is rendered server side and supports the display of sample images instead of stack names. The following options are available: \"filter_tags\": [list of tags], \"col_tags\": [list of tags], \"row_tags\": [list of tags], \"sample_images\": [true|false], \"sample_slice\": [slice number|\"first\"|\"center\"|\"last\"], \"sample_scaling\": [scaling percentage], \"sort\": [true|false]. By default projects are sorted and displayed without images. A valid configuration could look like: {\"row_tags\":[\"DAPI\",\"Crb\"],\"col_tags\":[\"Wing Disc\",\"CNS\"]}' );
"
),

        '2012-11-16T14:10:23' => new Migration(
                'Extend help text of project list and project table data views',
                "
UPDATE data_view_type
SET comment = 'A simple adjustable list of all projects and their stacks. This view is rendered server side and supports the display of sample images. The following options are available: \"filter_tags\": [list of tags], \"sample_images\": [true|false], \"sample_stack\": [\"first\"|\"last\"], \"sample_slice\": [slice number|\"first\"|\"center\"|\"last\"] and \"sample_scaling\": [scaling percentage]. By default projects are sorted. Use \"sort\":false to turn this off. Thus, a valid sample configuration could look like: {\"sample_images\":true,\"sample_stack\":\"last\",\"sample_slice\":\"center\",\"sample_scaling\":75,\"filter_tags\":[\"TagA\",\"TagB\"]}'
WHERE code_type = 'project_list_data_view';
UPDATE data_view_type
SET comment = 'A simple table of all projects and their stacks. This view is rendered server side and supports the display of sample images instead of stack names. The following options are available: \"filter_tags\": [list of tags], \"sample_images\": [true|false], \"sample_slice\": [slice number|\"first\"|\"center\"|\"last\"], \"sample_scaling\": [scaling percentage] and  \"sort\": [true|false]. By default projects are sorted and displayed without images. A valid configuration could look like: {\"sample_images\":true,\"sample_slice\":\"center\",\"sample_scaling\":42,\"filter_tags\":[\"TagA\",\"TagB\"]}'
WHERE code_type = 'project_table_data_view';
"
),

        '2012-12-19T17:10:23' => new Migration(
                'Extend help text of project list, project table and project tags data views',
                "
UPDATE data_view_type
SET comment = 'A simple adjustable list of all projects and their stacks. This view is rendered server side and supports the display of sample images. The following options are available: \"filter_tags\": [list of tags], \"sample_images\": [true|false], \"sample_stack\": [\"first\"|\"last\"], \"sample_slice\": [slice number|\"first\"|\"center\"|\"last\"], \"sample_width\": [pixel size] and \"sample_height\": [pixel size]. By default projects are sorted. Use \"sort\":false to turn this off. Thus, a valid sample configuration could look like: {\"sample_images\":true,\"sample_stack\":\"last\",\"sample_slice\":\"center\",\"sample_width\":100,\"filter_tags\":[\"TagA\",\"TagB\"]}'
WHERE code_type = 'project_list_data_view';
UPDATE data_view_type
SET comment = 'A simple table of all projects and their stacks. This view is rendered server side and supports the display of sample images instead of stack names. The following options are available: \"filter_tags\": [list of tags], \"sample_images\": [true|false], \"sample_slice\": [slice number|\"first\"|\"center\"|\"last\"], \"sample_width\": [pixel size], \"sample_height\": [pixel size] and \"sort\": [true|false]. By default projects are sorted and displayed without images. A valid configuration could look like: {\"sample_images\":true,\"sample_slice\":\"center\",\"sample_height\":42,\"filter_tags\":[\"TagA\",\"TagB\"]}'
WHERE code_type = 'project_table_data_view';
UPDATE data_view_type
SET comment = 'A table that allows to define tags for the columns and rows. This view is rendered server side and supports the display of sample images instead of stack names. The following options are available: \"filter_tags\": [list of tags], \"col_tags\": [list of tags], \"row_tags\": [list of tags], \"sample_images\": [true|false], \"sample_slice\": [slice number|\"first\"|\"center\"|\"last\"], \"sample_width\": [pixel size], \"sample_height\": [pixel size], \"sort\": [true|false]. By default projects are sorted and displayed without images. A valid configuration could look like: {\"row_tags\":[\"DAPI\",\"Crb\"],\"col_tags\":[\"Wing Disc\",\"CNS\"]}'
WHERE code_type = 'project_tags_data_view';
"
),

        '2013-01-08T10:08:48' => new Migration(
                'Add dataset tables',
                "
CREATE TABLE dataset (
    id integer NOT NULL,
    title text NOT NULL
);
CREATE SEQUENCE dataset_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
ALTER SEQUENCE dataset_id_seq OWNED BY dataset.id;
ALTER TABLE dataset ALTER COLUMN id SET DEFAULT nextval('dataset_id_seq'::regclass);
ALTER TABLE ONLY dataset
    ADD CONSTRAINT dataset_pkey PRIMARY KEY (id);

CREATE TABLE project_dataset (
    id integer NOT NULL,
    project_id integer NOT NULL,
    dataset_id integer NOT NULL
);
CREATE SEQUENCE project_dataset_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
ALTER SEQUENCE project_dataset_id_seq OWNED BY project_dataset.id;
ALTER TABLE project_dataset ALTER COLUMN id SET DEFAULT nextval('project_dataset_id_seq'::regclass);
ALTER TABLE ONLY project_dataset
    ADD CONSTRAINT project_dataset_pkey PRIMARY KEY (id);
ALTER TABLE ONLY project_dataset
    ADD CONSTRAINT project_id_fkey FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE ONLY project_dataset
    ADD CONSTRAINT dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES dataset(id);

CREATE TABLE dataset_stack (
    id integer NOT NULL,
    dataset_id integer NOT NULL,
    stack_id integer NOT NULL
);
CREATE SEQUENCE dataset_stack_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO MINVALUE
    CACHE 1;
ALTER SEQUENCE dataset_stack_id_seq OWNED BY dataset_stack.id;
ALTER TABLE dataset_stack ALTER COLUMN id SET DEFAULT nextval('dataset_stack_id_seq'::regclass);
ALTER TABLE ONLY dataset_stack
    ADD CONSTRAINT dataset_stack_pkey PRIMARY KEY (id);
ALTER TABLE ONLY dataset_stack
    ADD CONSTRAINT dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES dataset(id);
ALTER TABLE ONLY dataset_stack
    ADD CONSTRAINT stack_id_fkey FOREIGN KEY (stack_id) REFERENCES stack(id);
"
),

	// INSERT NEW MIGRATIONS HERE
	// (Don't remove the previous line, or inserting migration templates
	// won't work.)
	);

?>
