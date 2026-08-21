export namespace update {
	
	export class Info {
	    current: string;
	    latest: string;
	    available: boolean;
	    notes: string;
	    needsToken: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.current = source["current"];
	        this.latest = source["latest"];
	        this.available = source["available"];
	        this.notes = source["notes"];
	        this.needsToken = source["needsToken"];
	    }
	}

}

